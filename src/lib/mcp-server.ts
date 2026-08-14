import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getUserByUsername,
  listUsers,
  normalizeUsername,
  replyAndAckMessage,
  sendMessage,
  setOrgoComputerForUsername,
  setOrgoComputerForToken,
  type User,
} from "./users";
import { logActivitySafe, newRequestId } from "./activity";
import { runInboxWatch } from "./inbox-watch";
import {
  LIVE_AWAIT_TTL_MS,
  cancelConversationWait,
  upsertConversationWait,
} from "./conversation-waits";
import { DEFAULT_AWAIT_MAX_SECONDS } from "./constants";
import { normalizeOrgoComputerId, orgoRelayEnabled } from "./orgo-routing";
import { relayViaChatGptBrowser } from "./orgo";
import {
  orgoComputerActiveRelayCount,
  runOrgoRelayCoordinated,
} from "./orgo-relay-coordinator";
import { pluginMcpInstructions } from "./chatgpt-onboarding";
import type { InboxMessage } from "./users";
import { resolveContinueThread } from "./relay-thread";
import {
  bindProgressReporter,
  formatProgressTiming,
  withProgressHeartbeat,
  type McpToolExtra,
} from "./mcp-progress";

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

function cleanTarget(raw: string): string {
  return normalizeUsername(raw.replace(/^@+/, "").split(/\s+/)[0] || "");
}

async function relayPeerViaOrgo(input: {
  peerUsername: string;
  fromUsername: string;
  fromDisplayName?: string;
  computerId: string;
  outbound: InboxMessage;
  continueThread: boolean;
  requestId: string;
  report?: (message: string, progress: number) => Promise<void>;
}): Promise<{ reply: InboxMessage; orgo: { durationMs: number; steps?: number } }> {
  const peer = input.peerUsername;
  const t0 = Date.now();

  const relay = await runOrgoRelayCoordinated({
    computerId: input.computerId,
    conversationId: input.outbound.conversationId,
    continueThread: input.continueThread,
    onWait: input.report
      ? async (message) => {
          await input.report!(
            message.includes("slot")
              ? message
              : `Waiting for prior message to ${peer}…`,
            26
          );
        }
      : undefined,
    run: () =>
      relayViaChatGptBrowser(input.computerId, {
        fromUsername: input.fromUsername,
        fromDisplayName: input.fromDisplayName,
        message: input.outbound.body,
        conversationId: input.outbound.conversationId,
        peerUsername: peer,
        continueThread: input.continueThread,
        parallelWithOthers:
          !input.continueThread &&
          orgoComputerActiveRelayCount(input.computerId) > 1,
        onProgress: input.report,
      }),
  });
  if (input.report) {
    await input.report(`Saving reply from ${peer}…`, 95);
  }
  const combined = await replyAndAckMessage({
    fromUsername: input.peerUsername,
    toUsername: input.fromUsername,
    body: relay.replyText,
    conversationId: input.outbound.conversationId,
    replyToId: input.outbound.id,
    ackId: input.outbound.id,
  });
  if (!combined.ack) {
    console.warn(
      `[orgo] ack missed for outbound #${input.outbound.id} (${input.fromUsername}→${input.peerUsername})`
    );
  }
  logActivitySafe({
    kind: "orgo_relay",
    ok: true,
    username: input.fromUsername,
    peerUsername: input.peerUsername,
    httpStatus: 200,
    durationMs: Date.now() - t0,
    summary: `${input.fromUsername} → ${input.peerUsername} via Orgo (#${input.outbound.id})`,
      detail: {
      computerId: input.computerId,
      orgoMs: relay.durationMs,
      steps: relay.steps,
      replyId: combined.message.id,
      continueThread: relay.continueThread,
      relayMethod: relay.relayMethod,
    },
    requestId: input.requestId,
  });
  return {
    reply: combined.message,
    orgo: { durationMs: relay.durationMs, steps: relay.steps },
  };
}

function formatOrgoReply(
  msg: InboxMessage,
  reply: InboxMessage,
  peerUsername: string,
  timing: Record<string, number>,
  continueThread: boolean
) {
  const event = {
    id: reply.id,
    type: "peer_message" as const,
    at: reply.createdAt,
    text: reply.body,
    fromUsername: reply.fromUsername,
    toUsername: reply.toUsername,
    conversationId: reply.conversationId,
    replyToId: reply.replyToId,
    status: reply.status,
  };
  return jsonText({
    ok: true,
    message: msg,
    events: [event],
    event_count: 1,
    via: "orgo",
    next_action: "continue_conversation",
    conversation_id: msg.conversationId,
    peer_username: peerUsername,
    continue_thread: continueThread,
    timing,
    instructions: `Reply from ${peerUsername} via Airsup (their ChatGPT). Show it clearly. For follow-ups use talk_to_user(to="${peerUsername}", conversation_id="${msg.conversationId}", reply_to_id=${reply.id}) — same thread, faster.`,
  });
}

export function createAirsupMcpServer(me: User): McpServer {
  const server = new McpServer(
    { name: "airsup", version: "2.9.2" },
    { capabilities: { logging: {} }, instructions: pluginMcpInstructions(me.username) }
  );

  const readOnlyTool = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  } as const;

  const relayTool = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    idempotentHint: true,
  } as const;

  const noauthMeta = { securitySchemes: [{ type: "noauth" as const }] };

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "Return your airsup username and display name.",
      annotations: readOnlyTool,
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
        "List airsup users who have linked an Orgo computer (reachable peers). Optional query filters by username, display name, or bio.",
      inputSchema: {
        query: z.string().optional().describe("Optional search filter"),
        limit: z.number().optional().describe("Max results (default 50)"),
      },
      annotations: readOnlyTool,
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
      description:
        "Check whether a username exists and has an Orgo computer linked before messaging them.",
      inputSchema: {
        username: z.string().describe("Username to look up, e.g. kosti42"),
      },
      annotations: readOnlyTool,
      _meta: noauthMeta,
    },
    async ({ username }) => {
      const u = cleanTarget(username);
      const user = await getUserByUsername(u);
      if (!user || !user.orgoComputerId) {
        return jsonText({
          found: false,
          username: u,
          error: user
            ? `User "${u}" has not linked an Orgo computer yet`
            : `No user registered for "${u}"`,
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
      title: "Message peer via ChatGPT",
      description:
        "Send a plain message to another user's ChatGPT and wait for their reply. You think here; they see only a natural message from you.",
      inputSchema: {
        to: z.string().describe("Target username"),
        message: z
          .string()
          .describe(
            "Plain message their ChatGPT will read — natural language, no meta-instructions"
          ),
        conversation_id: z
          .string()
          .optional()
          .describe("Reuse from prior talk_to_user for follow-ups (faster, same ChatGPT thread)"),
        reply_to_id: z
          .number()
          .optional()
          .describe("Last peer message id in this conversation"),
      },
      annotations: relayTool,
      _meta: noauthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id }, extra: McpToolExtra) => {
      const started = Date.now();
      const requestId = newRequestId();
      const report = bindProgressReporter(extra, 100);
      const target = cleanTarget(to);
      const text = message.trim();
      if (!target) return errorText("to is required");
      if (!text) return errorText("message is required");

      await report("Starting airsup message…", 1);

      if (!orgoRelayEnabled()) {
        return errorText(
          "Airsup Orgo relay is not configured on the server (missing ORGO_API_KEY)."
        );
      }

      await report(`Looking up ${target}…`, 5);
      const peer = await getUserByUsername(target);
      if (!peer) {
        return errorText(
          `No user registered for "${target}". They need to complete airsup onboarding first.`
        );
      }

      if (!peer.orgoComputerId) {
        return errorText(
          `User "${peer.username}" has no Orgo computer linked yet. They need to paste their Orgo computer ID on the airsup onboarding page (or call set_orgo_computer).`
        );
      }

      const continueThread = resolveContinueThread({
        conversationId: conversation_id,
        replyToId: reply_to_id,
      });

      await report(`Recording message for ${peer.username}…`, 10);
      const tSend0 = Date.now();
      const msg = await sendMessage({
        fromUsername: me.username,
        toUsername: peer.username,
        body: text,
        conversationId: conversation_id,
        replyToId: reply_to_id ?? null,
      });
      const sendMs = Date.now() - tSend0;

      void upsertConversationWait({
        username: me.username,
        conversationId: msg.conversationId,
        peerUsername: peer.username,
        ttlMs: LIVE_AWAIT_TTL_MS,
        liveAwait: true,
      }).catch(() => {});

      await report(`Connecting to ${peer.username}'s Orgo computer…`, 16);
      await report(
        continueThread
          ? `Handoff to ${peer.username}'s ChatGPT (same thread)…`
          : `Handoff to ${peer.username}'s ChatGPT (new chat)…`,
        24
      );

      try {
        const orgoResult = await relayPeerViaOrgo({
          peerUsername: peer.username,
          fromUsername: me.username,
          fromDisplayName: me.displayName,
          computerId: peer.orgoComputerId,
          outbound: msg,
          continueThread,
          requestId,
          report,
        });
        await report(`Saving ${peer.username}'s reply…`, 96);
        await report(`Reply received from ${peer.username}.`, 100);
        logActivitySafe({
          kind: "talk",
          ok: true,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 200,
          durationMs: Date.now() - started,
          summary: `${me.username} → ${peer.username} (#${msg.id}) + orgo reply`,
          detail: { messageId: msg.id, replyId: orgoResult.reply.id, via: "orgo" },
          requestId,
        });
        return formatOrgoReply(msg, orgoResult.reply, peer.username, {
          send_ms: sendMs,
          orgo_ms: orgoResult.orgo.durationMs,
          total_ms: Date.now() - started,
        }, continueThread);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        logActivitySafe({
          kind: "orgo_relay",
          ok: false,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 502,
          durationMs: Date.now() - started,
          summary: `Orgo relay failed ${me.username} → ${peer.username}`,
          detail: { error: err, messageId: msg.id },
          requestId,
        });
        return errorText(
          continueThread
            ? `Orgo relay to ${peer.username} failed: ${err}. Retry talk_to_user with the same conversation_id="${msg.conversationId}" and reply_to_id=${reply_to_id ?? "?"}.`
            : `Orgo relay to ${peer.username} failed: ${err}. Retry talk_to_user(to="${peer.username}", conversation_id="${msg.conversationId}", message="...") — do NOT pass reply_to_id until you received a peer reply. await_reply will not help until a reply exists.`
        );
      }
    }
  );

  server.registerTool(
    "await_reply",
    {
      title: "Wait for peer reply",
      description:
        "Wait for a peer reply that was already sent to your inbox (e.g. delayed delivery). Not useful after Orgo relay failure — retry talk_to_user instead.",
      inputSchema: {
        from: z.string().describe("Peer username you are waiting on"),
        conversation_id: z.string(),
        after_message_id: z
          .number()
          .optional()
          .describe("Outbound talk_to_user message id"),
        max_seconds: z.number().optional().describe("Max wait this call (default 40)"),
      },
      annotations: relayTool,
      _meta: noauthMeta,
    },
    async (args, extra: McpToolExtra) => {
      const from = cleanTarget(args.from);
      const report = bindProgressReporter(extra, 100);
      await upsertConversationWait({
        username: me.username,
        conversationId: args.conversation_id,
        peerUsername: from,
        ttlMs: LIVE_AWAIT_TTL_MS,
        liveAwait: true,
      });
      const afterId = Number(args.after_message_id);
      const result = await withProgressHeartbeat(
        () =>
          runInboxWatch(
            me,
            {
              waitSeconds: 20,
              polls: 2,
              maxSeconds: args.max_seconds ?? DEFAULT_AWAIT_MAX_SECONDS,
              windowSeconds: 900,
              fromUsername: from,
              conversationId: args.conversation_id,
              afterMessageId:
                Number.isFinite(afterId) && afterId > 0 ? afterId : undefined,
            },
            { batch: true, mode: "conversation" }
          ),
        report,
        {
          startMessage: `Waiting for reply from ${from}…`,
          tickMessage: (t) =>
            `Waiting for ${from}'s reply… ${formatProgressTiming(t)}`,
          startProgress: 10,
          endProgress: 90,
          intervalMs: 5000,
          typicalMinSec: 5,
          typicalMaxSec: args.max_seconds ?? DEFAULT_AWAIT_MAX_SECONDS,
        }
      );
      if (result.event_count) {
        await report(`Reply received from ${from}.`, 100);
      }
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
      description: "Cancel waiting for a peer reply. Call when the user stops or cancels.",
      inputSchema: {
        conversation_id: z.string(),
        peer_username: z.string().optional(),
      },
      annotations: readOnlyTool,
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
        instructions: "Wait cancelled.",
      });
    }
  );

  server.registerTool(
    "set_orgo_computer",
    {
      title: "Link Orgo computer",
      description:
        "Save your Orgo computer UUID so others can message your ChatGPT via airsup. Find it in Orgo → your computer → General.",
      inputSchema: {
        orgo_computer_id: z
          .string()
          .describe("Orgo computer UUID from General settings, e.g. 099c33f0-..."),
      },
      annotations: relayTool,
      _meta: noauthMeta,
    },
    async ({ orgo_computer_id }) => {
      let id: string | null;
      try {
        id = normalizeOrgoComputerId(orgo_computer_id);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return errorText(err);
      }
      if (!id) return errorText("orgo_computer_id is required");
      try {
        const user = await setOrgoComputerForUsername({
          username: me.username,
          orgoComputerId: id,
        });
        return jsonText({
          ok: true,
          username: user.username,
          orgoComputerId: user.orgoComputerId,
          instructions:
            "Orgo computer linked. Leave ChatGPT open on that Orgo desktop — others can now talk_to_user you.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    }
  );

  return server;
}
