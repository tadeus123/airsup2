import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listUsers,
  normalizeUsername,
  replyAndAckMessage,
  resolvePeerUsername,
  sendMessage,
  setOrgoComputerForUsername,
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
import { runOrgoRelayCoordinated } from "./orgo-relay-coordinator";
import { wakePeerViaOrgo } from "./orgo-wake-relay";
import { pluginMcpInstructions } from "./chatgpt-onboarding";
import type { InboxMessage } from "./users";
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

type ResolveTargetResult =
  | { ok: false; error: string }
  | {
      ok: true;
      user: User;
      username: string;
      fuzzy: boolean;
      resolvedFrom: string;
    };

async function resolveTarget(raw: string | undefined): Promise<ResolveTargetResult> {
  const input = raw?.trim();
  if (!input) return { ok: false, error: "Username is required" };
  const resolved = await resolvePeerUsername(input);
  if (!resolved.ok) {
    const hint = resolved.candidates?.length
      ? ` Try: ${resolved.candidates.join(", ")}`
      : "";
    return { ok: false, error: `${resolved.error}.${hint}` };
  }
  return {
    ok: true,
    user: resolved.user,
    username: resolved.user.username,
    fuzzy: resolved.fuzzy,
    resolvedFrom: resolved.resolvedFrom,
  };
}

async function wakePeerOnOrgo(input: {
  peerUsername: string;
  fromUsername: string;
  computerId: string;
  conversationId: string;
  outboundId: number;
  requestId: string;
  report?: (message: string, progress: number) => Promise<void>;
}): Promise<{ durationMs: number }> {
  const t0 = Date.now();
  const wake = await runOrgoRelayCoordinated({
    computerId: input.computerId,
    conversationId: input.conversationId,
    continueThread: false,
    onWait: input.report
      ? async (message) => {
          await input.report!(
            message.includes("slot")
              ? message
              : `Waiting for prior wake on ${input.peerUsername}'s Orgo…`,
            26
          );
        }
      : undefined,
    run: () =>
      wakePeerViaOrgo(input.computerId, {
        fromUsername: input.fromUsername,
        messageId: input.outboundId,
        peerUsername: input.peerUsername,
        onProgress: input.report,
      }),
  });
  logActivitySafe({
    kind: "orgo_wake",
    ok: true,
    username: input.fromUsername,
    peerUsername: input.peerUsername,
    httpStatus: 200,
    durationMs: Date.now() - t0,
    summary: `${input.fromUsername} woke ${input.peerUsername} (#${input.outboundId})`,
    detail: {
      computerId: input.computerId,
      orgoMs: wake.durationMs,
      outboundId: input.outboundId,
    },
    requestId: input.requestId,
  });
  return wake;
}

function formatWakeSent(
  msg: InboxMessage,
  peerUsername: string,
  timing: Record<string, number>
) {
  return jsonText({
    ok: true,
    message: msg,
    via: "wake",
    next_action: "await_reply",
    conversation_id: msg.conversationId,
    peer_username: peerUsername,
    timing,
    instructions: `Message stored and ${peerUsername} woken. Call await_reply(from="${peerUsername}", conversation_id="${msg.conversationId}", after_message_id=${msg.id}). Their Supi will pick up the message via check_inbox and reply via reply_to_user.`,
  });
}

export function createAirsupMcpServer(me: User): McpServer {
  const server = new McpServer(
    { name: "airsup", version: "3.0.0" },
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
        "Check whether a username exists and has an Orgo computer linked. Accepts nicknames (tade → tade1, kosti2 → kosti).",
      inputSchema: {
        username: z.string().describe("Username or nickname, e.g. tade, tade1, kosti2"),
      },
      annotations: readOnlyTool,
      _meta: noauthMeta,
    },
    async ({ username }) => {
      const match = await resolveTarget(username);
      if (!match.ok) {
        return jsonText({ found: false, query: username, error: match.error });
      }
      const { user, fuzzy, resolvedFrom } = match;
      if (!user.orgoComputerId) {
        return jsonText({
          found: false,
          query: username,
          username: user.username,
          error: `User "${user.username}" has not linked an Orgo computer yet`,
        });
      }
      return jsonText({
        found: true,
        query: username,
        username: user.username,
        resolved_from: fuzzy ? resolvedFrom : undefined,
        displayName: user.displayName,
        bio: user.bio,
        talkPhrase: `talk to ${user.username}`,
      });
    }
  );

  server.registerTool(
    "check_inbox",
    {
      title: "Check inbound messages",
      description:
        "Call immediately when you see @airsup inbound from {sender} #{id}. Fetches that one message. Then reply_to_user — never ask the human, never talk_to_user.",
      inputSchema: {
        from: z.string().optional().describe("Optional filter by sender username or nickname"),
        message_id: z
          .number()
          .optional()
          .describe("Exact inbound message id from wake line (@airsup sender #123)"),
        max_seconds: z.number().optional().describe("Max wait (default 15)"),
      },
      annotations: readOnlyTool,
      _meta: noauthMeta,
    },
    async ({ from, message_id, max_seconds }, extra: McpToolExtra) => {
      let sender: string | undefined;
      if (from) {
        const match = await resolveTarget(from);
        if (!match.ok) return errorText(match.error);
        sender = match.username;
      }
      const exactId = Number(message_id);
      const messageId =
        Number.isFinite(exactId) && exactId > 0 ? exactId : undefined;
      const maxSec = max_seconds ?? 15;
      const report = bindProgressReporter(extra, 100);
      const label = sender ? `@${sender}` : "inbox";

      const result = await withProgressHeartbeat(
        () =>
          runInboxWatch(
            me,
            {
              waitSeconds: 5,
              polls: 3,
              maxSeconds: maxSec,
              windowSeconds: 120,
              fromUsername: sender,
              messageId,
            },
            { batch: true, mode: "scanner" }
          ),
        report,
        {
          startMessage: sender
            ? `Checking airsup for new message from ${sender}…`
            : "Checking airsup inbox for new messages…",
          tickMessage: (t) => `Scanning ${label}… ${formatProgressTiming(t)}`,
          startProgress: 10,
          endProgress: 88,
          intervalMs: 3000,
          typicalMinSec: 2,
          typicalMaxSec: maxSec,
        }
      );

      if (result.event_count) {
        const fromWho = result.events[0]?.fromUsername || sender || "peer";
        await report(`Found message from @${fromWho} — reading…`, 95);
      } else {
        await report(`No new messages in ${label}.`, 95);
      }

      logActivitySafe({
        kind: "check_inbox",
        ok: true,
        username: me.username,
        peerUsername: sender || result.events[0]?.fromUsername || "",
        httpStatus: 200,
        durationMs: result.timing.total_ms ?? 0,
        summary: `${me.username} check_inbox → ${result.event_count} message(s)`,
        detail: { from: sender || null, eventCount: result.event_count },
      });
      return jsonText({
        ...result,
        thread: result.event_count
          ? { direction: "inbound", handle_this_message_only: true }
          : { direction: "inbound", empty: true },
        reply_hints: result.events.map((e) => ({
          to: e.fromUsername,
          conversation_id: e.conversationId,
          reply_to_id: e.id,
        })),
        next_action: result.event_count ? "reply_to_user" : "check_inbox",
        instructions: result.event_count
          ? "Inbound thread only — answer and reply_to_user using reply_hints[0]. Do NOT talk_to_user."
          : messageId
            ? `Message #${messageId} not found yet — retry check_inbox with same message_id.`
            : "No new messages. Call check_inbox again or wait for another @airsup wake.",
      });
    }
  );

  server.registerTool(
    "reply_to_user",
    {
      title: "Reply to airsup user",
      description:
        "Send your reply back to another airsup user after check_inbox. Delivers directly via API.",
      inputSchema: {
        to: z.string().describe("Recipient username (who messaged you)"),
        message: z.string().describe("Your reply text"),
        conversation_id: z.string().describe("From the inbound message"),
        reply_to_id: z.number().describe("Inbound message id you are answering"),
      },
      annotations: relayTool,
      _meta: noauthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id }) => {
      const match = await resolveTarget(to);
      if (!match.ok) return errorText(match.error);
      const target = match.username;
      const body = message.trim();
      if (!target) return errorText("to is required");
      if (!body) return errorText("message is required");
      if (!conversation_id.trim()) return errorText("conversation_id is required");
      const inboundId = Number(reply_to_id);
      if (!Number.isFinite(inboundId) || inboundId <= 0) {
        return errorText("reply_to_id is required");
      }

      try {
        const combined = await replyAndAckMessage({
          fromUsername: me.username,
          toUsername: target,
          body,
          conversationId: conversation_id.trim(),
          replyToId: inboundId,
          ackId: inboundId,
        });
        logActivitySafe({
          kind: "reply_and_ack",
          ok: true,
          username: me.username,
          peerUsername: target,
          httpStatus: 200,
          durationMs: 0,
          summary: `${me.username} → ${target} reply (#${combined.message.id})`,
          detail: {
            replyId: combined.message.id,
            ackId: inboundId,
            conversationId: conversation_id,
          },
        });
        return jsonText({
          ok: true,
          message: combined.message,
          acked_inbound_id: inboundId,
          via: "api",
          next_action: "finish",
          instructions: `Reply sent to ${target}. They will receive it via await_reply on their side.`,
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "talk_to_user",
    {
      title: "Message peer",
      description:
        "Initiate contact ONLY when your user asks you to message someone. Do NOT use to reply to inbound messages — use reply_to_user instead.",
      inputSchema: {
        to: z.string().describe("Target username or nickname (tade → tade1, kosti2 → kosti)"),
        message: z
          .string()
          .describe("Plain message — delivered to their Supi via check_inbox"),
        conversation_id: z
          .string()
          .optional()
          .describe("Reuse from prior talk_to_user for follow-ups in the same thread"),
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
      const text = message.trim();
      if (!text) return errorText("message is required");

      await report("Starting airsup message…", 1);

      if (!orgoRelayEnabled()) {
        return errorText(
          "Airsup Orgo relay is not configured on the server (missing ORGO_API_KEY)."
        );
      }

      await report(`Looking up ${to}…`, 5);
      const match = await resolveTarget(to);
      if (!match.ok) return errorText(match.error);
      const peer = match.user;
      if (match.fuzzy) {
        await report(`Resolved "${match.resolvedFrom}" → ${peer.username}`, 8);
      }

      if (!peer.orgoComputerId) {
        return errorText(
          `User "${peer.username}" has no Orgo computer linked yet. They need to paste their Orgo computer ID on the airsup onboarding page (or call set_orgo_computer).`
        );
      }

      await report(`Recording message for ${peer.username}…`, 12);
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

      await report(`Waking ${peer.username}'s ChatGPT…`, 20);

      try {
        const wake = await wakePeerOnOrgo({
          peerUsername: peer.username,
          fromUsername: me.username,
          computerId: peer.orgoComputerId,
          conversationId: msg.conversationId,
          outboundId: msg.id,
          requestId,
          report,
        });
        await report(`${peer.username} woken — waiting for their Supi to reply…`, 90);
        logActivitySafe({
          kind: "talk",
          ok: true,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 200,
          durationMs: Date.now() - started,
          summary: `${me.username} → ${peer.username} (#${msg.id}) wake sent`,
          detail: { messageId: msg.id, via: "wake", orgoMs: wake.durationMs },
          requestId,
        });
        return formatWakeSent(msg, peer.username, {
          send_ms: sendMs,
          wake_ms: wake.durationMs,
          total_ms: Date.now() - started,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        logActivitySafe({
          kind: "orgo_wake",
          ok: false,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 502,
          durationMs: Date.now() - started,
          summary: `Orgo wake failed ${me.username} → ${peer.username}`,
          detail: { error: err, messageId: msg.id },
          requestId,
        });
        return errorText(
          `Orgo wake to ${peer.username} failed: ${err}. Message is stored — retry talk_to_user with conversation_id="${msg.conversationId}" or use await_reply if they may have already replied.`
        );
      }
    }
  );

  server.registerTool(
    "await_reply",
    {
      title: "Wait for peer reply",
      description:
        "Wait for a peer's Supi to reply via reply_to_user after you called talk_to_user.",
      inputSchema: {
        from: z.string().describe("Peer username or nickname (tade → tade1)"),
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
      const match = await resolveTarget(args.from);
      if (!match.ok) return errorText(match.error);
      const from = match.username;
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
            `Waiting for ${from}'s Supi… ${formatProgressTiming(t)}`,
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
