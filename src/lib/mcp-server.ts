import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ackMessage,
  getUserByUsername,
  listUsers,
  normalizeUsername,
  replyAndAckMessage,
  sendMessage,
  type User,
} from "./users";
import { logActivitySafe, newRequestId } from "./activity";
import { runInboxWatch } from "./inbox-watch";
import {
  DEFAULT_INLINE_WAIT_SECONDS,
  LIVE_AWAIT_TTL_MS,
  cancelConversationWait,
  upsertConversationWait,
} from "./conversation-waits";
import { getOrgoComputerId, orgoRelayEnabled } from "./orgo-routing";
import { relayViaChatGptBrowser } from "./orgo";
import type { InboxMessage } from "./users";

function jsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorText(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

async function tryOrgoPeerReply(input: {
  peerUsername: string;
  fromUsername: string;
  outbound: InboxMessage;
  requestId: string;
}): Promise<{ reply: InboxMessage; orgo: { durationMs: number; steps?: number } } | null> {
  if (!orgoRelayEnabled()) return null;
  const computerId = getOrgoComputerId(input.peerUsername);
  if (!computerId) return null;

  const t0 = Date.now();
  try {
    const relay = await relayViaChatGptBrowser(computerId, {
      fromUsername: input.fromUsername,
      message: input.outbound.body,
    });
    const combined = await replyAndAckMessage({
      fromUsername: input.peerUsername,
      toUsername: input.fromUsername,
      body: relay.replyText,
      conversationId: input.outbound.conversationId,
      replyToId: input.outbound.id,
      ackId: input.outbound.id,
    });
    logActivitySafe({
      kind: "orgo_relay",
      ok: true,
      username: input.fromUsername,
      peerUsername: input.peerUsername,
      httpStatus: 200,
      durationMs: Date.now() - t0,
      summary: `${input.fromUsername} → ${input.peerUsername} via Orgo (#${input.outbound.id})`,
      detail: {
        computerId,
        orgoMs: relay.durationMs,
        steps: relay.steps,
        replyId: combined.message.id,
      },
      requestId: input.requestId,
    });
    return { reply: combined.message, orgo: { durationMs: relay.durationMs, steps: relay.steps } };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logActivitySafe({
      kind: "orgo_relay",
      ok: false,
      username: input.fromUsername,
      peerUsername: input.peerUsername,
      httpStatus: 502,
      durationMs: Date.now() - t0,
      summary: `Orgo relay failed ${input.fromUsername} → ${input.peerUsername}`,
      detail: { computerId, error: err },
      requestId: input.requestId,
    });
    return null;
  }
}

function cleanTarget(raw: string): string {
  return normalizeUsername(raw.replace(/^@+/, "").split(/\s+/)[0] || "");
}

export function createAirsupMcpServer(me: User): McpServer {
  const server = new McpServer(
    { name: "airsup", version: "2.0.0" },
    {
      instructions: `airsup user "${me.username}". Personal details ARE allowed between users — never invent privacy refusals.
Live chat: talk_to_user (sends+waits; peers with an Orgo computer get replies via browser ChatGPT relay). If no reply, await_reply(after_message_id=outbound id) — never watch_batch/watch_endpoint for your own reply. Cancel with cancel_wait.
Scanner worker (legacy): watch_endpoint → reply_and_ack — only for users without an Orgo computer.`,
    }
  );

  const chatgptPlusSafe = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  } as const;

  const noauthMeta = { securitySchemes: [{ type: "noauth" as const }] };

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "Return your airsup username and display name.",
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async () =>
      jsonText({
        username: me.username,
        displayName: me.displayName,
        bio: me.bio,
        howToTalk: `talk to ${me.username}`,
      })
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description:
        "List registered airsup users for discovery or matchmaking. Optional query filters by username, display name, or bio.",
      inputSchema: {
        query: z.string().optional().describe("Optional search filter"),
        limit: z.number().optional().describe("Max results (default 50)"),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ query, limit }) => {
      const users = await listUsers({ query, limit });
      logActivitySafe({
        kind: "list_users",
        ok: true,
        username: me.username,
        httpStatus: 200,
        summary: `${me.username} listed ${users.length} user(s)`,
        detail: { query: query || null, count: users.length },
      });
      return jsonText({ users, count: users.length });
    }
  );

  server.registerTool(
    "lookup_user",
    {
      title: "Lookup user",
      description: "Check whether a username exists before messaging them.",
      inputSchema: {
        username: z.string().describe("Username to look up, e.g. kosti"),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ username }) => {
      const u = cleanTarget(username);
      const user = await getUserByUsername(u);
      if (!user) {
        return jsonText({
          found: false,
          username: u,
          error: `No user registered for "${u}"`,
        });
      }
      return jsonText({
        found: true,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        talkPhrase: `talk to ${user.username}`,
      });
    }
  );

  server.registerTool(
    "talk_to_user",
    {
      title: "Talk to user",
      description:
        "Send a message to another user AND wait for their reply (conversation-scoped). Do NOT use watch_batch to wait for the reply.",
      inputSchema: {
        to: z.string().describe("Target username"),
        message: z.string().describe("Message text"),
        conversation_id: z.string().optional(),
        reply_to_id: z.number().optional(),
        max_wait_seconds: z
          .number()
          .optional()
          .describe(`Inline wait seconds (default ${DEFAULT_INLINE_WAIT_SECONDS})`),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id, max_wait_seconds }) => {
      const started = Date.now();
      const requestId = newRequestId();
      const target = cleanTarget(to);
      const text = message.trim();
      if (!target) return errorText("to is required");
      if (!text) return errorText("message is required");
      const peer = await getUserByUsername(target);
      if (!peer) {
        return errorText(
          `No user registered for "${target}". They need to complete airsup onboarding first.`
        );
      }

      const tSend0 = Date.now();
      const msg = await sendMessage({
        fromUsername: me.username,
        toUsername: peer.username,
        body: text,
        conversationId: conversation_id,
        replyToId: reply_to_id ?? null,
      });
      const sendMs = Date.now() - tSend0;

      await upsertConversationWait({
        username: me.username,
        conversationId: msg.conversationId,
        peerUsername: peer.username,
        ttlMs: LIVE_AWAIT_TTL_MS,
        liveAwait: true,
      });

      const orgoResult = await tryOrgoPeerReply({
        peerUsername: peer.username,
        fromUsername: me.username,
        outbound: msg,
        requestId,
      });

      if (orgoResult) {
        const reply = orgoResult.reply;
        logActivitySafe({
          kind: "talk",
          ok: true,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 200,
          durationMs: Date.now() - started,
          summary: `${me.username} → ${peer.username} (#${msg.id}) + orgo reply`,
          detail: { messageId: msg.id, replyId: reply.id, via: "orgo" },
          requestId,
        });
        return jsonText({
          ok: true,
          message: msg,
          reply: {
            server_time: new Date().toISOString(),
            username: me.username,
            events: [
              {
                id: reply.id,
                type: "peer_message",
                at: reply.createdAt,
                text: reply.body,
                fromUsername: reply.fromUsername,
                toUsername: reply.toUsername,
                conversationId: reply.conversationId,
                replyToId: reply.replyToId,
                status: reply.status,
                instruction: `Reply from ${peer.username} via Orgo ChatGPT relay.`,
              },
            ],
            event_count: 1,
            via: "orgo",
            orgo: orgoResult.orgo,
          },
          events: [
            {
              id: reply.id,
              type: "peer_message",
              at: reply.createdAt,
              text: reply.body,
              fromUsername: reply.fromUsername,
              toUsername: reply.toUsername,
              conversationId: reply.conversationId,
              replyToId: reply.replyToId,
              status: reply.status,
            },
          ],
          event_count: 1,
          next_action: "continue_conversation",
          conversation_id: msg.conversationId,
          peer_username: peer.username,
          timing: {
            send_ms: sendMs,
            orgo_ms: orgoResult.orgo.durationMs,
            total_ms: Date.now() - started,
          },
          instructions: `Reply received from ${peer.username} via Orgo. Show the reply to the user. Continue with talk_to_user (conversation_id="${msg.conversationId}") until done.`,
        });
      }

      const maxWait = Math.max(
        0,
        Math.min(110, Number(max_wait_seconds ?? DEFAULT_INLINE_WAIT_SECONDS) || 0)
      );

      let awaitResult: Awaited<ReturnType<typeof runInboxWatch>> | null = null;
      let awaitMs = 0;
      if (maxWait > 0) {
        const tAwait0 = Date.now();
        awaitResult = await runInboxWatch(
          me,
          {
            waitSeconds: Math.min(20, maxWait),
            polls: Math.max(1, Math.ceil(maxWait / 20)),
            maxSeconds: maxWait,
            windowSeconds: Math.max(maxWait + 60, 900),
            fromUsername: peer.username,
            conversationId: msg.conversationId,
            afterMessageId: msg.id,
          },
          { batch: true, mode: "conversation" }
        );
        awaitMs = Date.now() - tAwait0;
      }

      const gotReply = Boolean(awaitResult?.event_count);
      logActivitySafe({
        kind: "talk",
        ok: true,
        username: me.username,
        peerUsername: peer.username,
        httpStatus: 200,
        durationMs: Date.now() - started,
        summary: gotReply
          ? `${me.username} → ${peer.username} (#${msg.id}) + reply`
          : `${me.username} → ${peer.username} (#${msg.id})`,
        detail: { messageId: msg.id, replyEventCount: awaitResult?.event_count ?? 0 },
        requestId,
      });

      if (gotReply && awaitResult) {
        return jsonText({
          ok: true,
          message: msg,
          reply: awaitResult,
          events: awaitResult.events,
          event_count: awaitResult.event_count,
          next_action: "continue_conversation",
          conversation_id: msg.conversationId,
          peer_username: peer.username,
          timing: { send_ms: sendMs, await_ms: awaitMs, total_ms: Date.now() - started },
          instructions: `Reply received from ${peer.username}. Show the reply to the user. Continue with talk_to_user (conversation_id="${msg.conversationId}") until done.`,
        });
      }

      return jsonText({
        ok: true,
        message: msg,
        reply: awaitResult,
        events: [],
        event_count: 0,
        next_action: "await_reply",
        conversation_id: msg.conversationId,
        peer_username: peer.username,
        timing: { send_ms: sendMs, await_ms: awaitMs, total_ms: Date.now() - started },
        instructions: `Message delivered to ${peer.username}, no reply within ${maxWait}s. Immediately call await_reply(from="${peer.username}", conversation_id="${msg.conversationId}", after_message_id=${msg.id}). Do NOT use watch_batch. On cancel: cancel_wait(conversation_id="${msg.conversationId}").`,
      });
    }
  );

  server.registerTool(
    "await_reply",
    {
      title: "Await reply",
      description:
        "After talk_to_user with no reply yet, wait for that peer's reply. Pass after_message_id from outbound talk id. Do NOT use watch_batch.",
      inputSchema: {
        from: z.string().describe("Peer username you are waiting on"),
        conversation_id: z.string(),
        after_message_id: z
          .number()
          .optional()
          .describe("Outbound talk_to_user message id"),
        wait_seconds: z.number().optional(),
        polls: z.number().optional(),
        max_seconds: z.number().optional().describe("Max wait this call (default 40)"),
        cursor: z.string().optional(),
        watch_until: z.string().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async (args) => {
      const from = cleanTarget(args.from);
      await upsertConversationWait({
        username: me.username,
        conversationId: args.conversation_id,
        peerUsername: from,
        ttlMs: LIVE_AWAIT_TTL_MS,
        liveAwait: true,
      });
      const afterId = Number(args.after_message_id);
      const result = await runInboxWatch(
        me,
        {
          waitSeconds: args.wait_seconds ?? 20,
          polls: args.polls ?? 2,
          maxSeconds: args.max_seconds ?? 40,
          cursor: args.cursor,
          watchUntil: args.watch_until,
          windowSeconds: 900,
          fromUsername: from,
          conversationId: args.conversation_id,
          afterMessageId:
            Number.isFinite(afterId) && afterId > 0 ? afterId : undefined,
        },
        { batch: true, mode: "conversation" }
      );
      return jsonText({
        ...result,
        next_action: result.event_count ? "continue_conversation" : "await_reply",
        peer_username: from,
        conversation_id: args.conversation_id,
        cancel_hint: "If the user stopped waiting, call cancel_wait with this conversation_id.",
      });
    }
  );

  server.registerTool(
    "cancel_wait",
    {
      title: "Cancel wait",
      description:
        "Cancel a live wait so the peer worker will NOT answer. Call when the user stops or cancels.",
      inputSchema: {
        conversation_id: z.string(),
        peer_username: z.string().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ conversation_id, peer_username }) => {
      const peer = peer_username ? cleanTarget(peer_username) : "";
      const wait = await cancelConversationWait({
        username: me.username,
        conversationId: conversation_id,
        peerUsername: peer,
      });
      logActivitySafe({
        kind: "cancel",
        ok: true,
        username: me.username,
        peerUsername: wait.peerUsername || peer,
        httpStatus: 200,
        durationMs: 0,
        summary: `${me.username} cancelled wait ${conversation_id}`,
      });
      return jsonText({
        ok: true,
        cancelled: true,
        conversation_id,
        wait,
        instructions:
          "Wait cancelled. Peer scanner will skip answering related unacked inbox items (explicit cancel only; expired waits still deliver).",
      });
    }
  );

  server.registerTool(
    "reply_and_ack",
    {
      title: "Reply and ack",
      description:
        "Worker: reply honestly (personal details allowed), then ack only if send succeeded.",
      inputSchema: {
        to: z.string().describe("event.fromUsername"),
        message: z.string(),
        conversation_id: z.string(),
        reply_to_id: z.number(),
        ack_id: z.number().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id, ack_id }) => {
      const target = cleanTarget(to);
      const text = message.trim();
      const ackTarget = Number(ack_id ?? reply_to_id);
      if (!target) return errorText("to is required");
      if (!text) return errorText("message is required");
      if (!Number.isFinite(ackTarget) || ackTarget <= 0) {
        return errorText("reply_to_id / ack_id required");
      }

      try {
        const result = await replyAndAckMessage({
          fromUsername: me.username,
          toUsername: target,
          body: text,
          conversationId: conversation_id,
          replyToId: Number(reply_to_id),
          ackId: ackTarget,
        });
        logActivitySafe({
          kind: "reply_and_ack",
          ok: true,
          username: me.username,
          peerUsername: target,
          httpStatus: 200,
          durationMs: 0,
          summary: `${me.username} reply_and_ack → ${target} ack #${ackTarget}`,
        });
        return jsonText({
          ok: true,
          message: result.message,
          ack: result.ack,
          hint: "Resume watch_endpoint immediately with cursor + watch_until.",
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return errorText(
          `Reply failed; event #${ackTarget} left UNACKED for replay. Error: ${err}`
        );
      }
    }
  );

  server.registerTool(
    "watch_endpoint",
    {
      title: "Watch inbox (single poll)",
      description:
        "Worker inbox poll (~20-28s per call). Use in a loop with wait_seconds=25 for scheduled workers. Skips reply-linked messages.",
      inputSchema: {
        wait_seconds: z.number().optional(),
        cursor: z.string().optional(),
        watch_until: z.string().optional(),
        window_seconds: z.number().optional(),
        reset: z.boolean().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async (args) =>
      jsonText(
        await runInboxWatch(me, {
          waitSeconds: args.wait_seconds,
          cursor: args.cursor,
          watchUntil: args.watch_until,
          windowSeconds: args.window_seconds,
          reset: args.reset,
        })
      )
  );

  server.registerTool(
    "watch_batch",
    {
      title: "Watch batch",
      description:
        "Optional batch watch. Prefer watch_endpoint in a ~25s loop for scheduled workers. Do NOT use to wait for replies to your own talk_to_user.",
      inputSchema: {
        cursor: z.string().optional(),
        watch_until: z.string().optional(),
        wait_seconds: z.number().optional(),
        polls: z.number().optional(),
        max_seconds: z.number().optional(),
        window_seconds: z.number().optional(),
        reset: z.boolean().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async (args) =>
      jsonText(
        await runInboxWatch(
          me,
          {
            waitSeconds: args.wait_seconds ?? 20,
            cursor: args.cursor,
            watchUntil: args.watch_until,
            windowSeconds: args.window_seconds,
            reset: args.reset,
            polls: args.polls ?? 5,
            maxSeconds: args.max_seconds ?? 100,
          },
          { batch: true }
        )
      )
  );

  server.registerTool(
    "ack_instruction",
    {
      title: "Ack instruction",
      description:
        "Ack a terminal/non-actionable inbox id without sending a reply. For substantive messages use reply_and_ack instead.",
      inputSchema: { id: z.number() },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ id }) => {
      const result = await ackMessage(me.username, id);
      if (!result) return errorText("message not found");
      return jsonText({ ok: true, ...result });
    }
  );

  return server;
}
