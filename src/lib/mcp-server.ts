import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
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
  LIVE_AWAIT_TTL_MS,
  cancelConversationWait,
  upsertConversationWait,
} from "./conversation-waits";
import { DEFAULT_AWAIT_MAX_SECONDS } from "./constants";
import { getOrgoComputerId, orgoRelayEnabled } from "./orgo-routing";
import { relayViaChatGptBrowser } from "./orgo";
import { pluginMcpInstructions } from "./chatgpt-onboarding";
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

function cleanTarget(raw: string): string {
  return normalizeUsername(raw.replace(/^@+/, "").split(/\s+/)[0] || "");
}

async function relayPeerViaOrgo(input: {
  peerUsername: string;
  fromUsername: string;
  outbound: InboxMessage;
  requestId: string;
}): Promise<{ reply: InboxMessage; orgo: { durationMs: number; steps?: number } }> {
  const computerId = getOrgoComputerId(input.peerUsername);
  if (!computerId) {
    throw new Error(
      `User "${input.peerUsername}" has no Orgo computer mapped. They need to complete Orgo setup first.`
    );
  }

  const t0 = Date.now();
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
  return {
    reply: combined.message,
    orgo: { durationMs: relay.durationMs, steps: relay.steps },
  };
}

function formatOrgoReply(
  msg: InboxMessage,
  reply: InboxMessage,
  peerUsername: string,
  timing: Record<string, number>
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
    timing,
    instructions: `Reply received from ${peerUsername} via Orgo ChatGPT relay. Show it to the user. Continue with talk_to_user (conversation_id="${msg.conversationId}") for follow-ups.`,
  });
}

export function createAirsupMcpServer(me: User): McpServer {
  const server = new McpServer(
    { name: "airsup", version: "2.1.0" },
    { instructions: pluginMcpInstructions(me.username) }
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
        "List registered airsup users for discovery. Optional query filters by username, display name, or bio.",
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
        username: z.string().describe("Username to look up, e.g. kosti42"),
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
        "Send a message to another user and wait for their ChatGPT reply (via Orgo browser relay). Can take 30–120 seconds.",
      inputSchema: {
        to: z.string().describe("Target username"),
        message: z.string().describe("Message text"),
        conversation_id: z.string().optional(),
        reply_to_id: z.number().optional(),
      },
      annotations: chatgptPlusSafe,
      _meta: noauthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id }) => {
      const started = Date.now();
      const requestId = newRequestId();
      const target = cleanTarget(to);
      const text = message.trim();
      if (!target) return errorText("to is required");
      if (!text) return errorText("message is required");

      if (!orgoRelayEnabled()) {
        return errorText(
          "Airsup Orgo relay is not configured on the server (missing ORGO_API_KEY)."
        );
      }

      const peer = await getUserByUsername(target);
      if (!peer) {
        return errorText(
          `No user registered for "${target}". They need to complete airsup onboarding first.`
        );
      }

      if (!getOrgoComputerId(peer.username)) {
        return errorText(
          `User "${peer.username}" has no Orgo computer mapped yet. They need to set up Orgo first.`
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

      try {
        const orgoResult = await relayPeerViaOrgo({
          peerUsername: peer.username,
          fromUsername: me.username,
          outbound: msg,
          requestId,
        });
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
        });
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
          `Orgo relay to ${peer.username} failed: ${err}. You can retry with talk_to_user (same conversation_id="${msg.conversationId}") or await_reply.`
        );
      }
    }
  );

  server.registerTool(
    "await_reply",
    {
      title: "Await reply",
      description:
        "Wait for a peer reply after talk_to_user failed or timed out. Pass after_message_id from the outbound message id.",
      inputSchema: {
        from: z.string().describe("Peer username you are waiting on"),
        conversation_id: z.string(),
        after_message_id: z
          .number()
          .optional()
          .describe("Outbound talk_to_user message id"),
        max_seconds: z.number().optional().describe("Max wait this call (default 40)"),
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
      description: "Cancel waiting for a peer reply. Call when the user stops or cancels.",
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
        instructions: "Wait cancelled.",
      });
    }
  );

  return server;
}
