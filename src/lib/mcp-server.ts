import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  inboundFirstContactBlocksTalk,
  getInboundMessage,
  getMessageFromUsername,
  getOutboundWait,
  listUsers,
  markDelivered,
  markWakeSent,
  normalizeUsername,
  replyAndAckMessage,
  resolvePeerUsername,
  sendMessage,
  setOrgoComputerForUsername,
  type InboxMessage,
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
import { wakePeerViaOrgo, parseInboxRef } from "./orgo-wake-relay";
import { pluginMcpInstructions } from "./chatgpt-onboarding";
import { checkCompanyDomains, normalizeDomain } from "./companies";
import { talkToCompanyEndpoint } from "./company-negotiate";
import {
  awaitInstructionsForPeerStatus,
  describePeerWait,
} from "./peer-wait-status";
import {
  companyConversationGuard,
  companyDomainGuard,
  peerConversationGuard,
} from "./conversation-scope";
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
    messageId: input.outboundId,
    computerId: input.computerId,
    detail: {
      computerId: input.computerId,
      orgoMs: wake.durationMs,
      outboundId: input.outboundId,
    },
    requestId: input.requestId,
  });
  return wake;
}

function inboundConversationMarker(conversationId: string): number | undefined {
  const m = /^#?(\d+)$/.exec(conversationId.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function isolatedInboxPayload(inbound: InboxMessage) {
  return {
    ok: true,
    channel: "peer" as const,
    isolation: "strict",
    peer_message: {
      id: inbound.id,
      from: inbound.fromUsername,
      text: inbound.body,
      conversation_id: inbound.conversationId,
      created_at: inbound.createdAt,
    },
    reply_hints: {
      to: inbound.fromUsername,
      conversation_id: inbound.conversationId,
      reply_to_id: inbound.id,
    },
    scope:
      "Answer peer_message.text only (ignore other airsup inbox items). Use your own ChatGPT tools — past chats, Gmail, Drive, connectors — to actually answer. Airsup is just the send/receive pipe.",
    next_action: "reply_to_user",
    instructions: `Use your own tools to answer, then reply_to_user(to="${inbound.fromUsername}", message=your answer, conversation_id="${inbound.conversationId}", reply_to_id=${inbound.id}). Do not use talk_to_user for inbound replies.`,
  };
}

function formatWakeSent(
  msg: InboxMessage,
  peerUsername: string,
  timing: Record<string, number>
) {
  return jsonText({
    ok: true,
    channel: "peer",
    message: msg,
    via: "wake",
    next_action: "await_reply",
    conversation_id: msg.conversationId,
    peer_username: peerUsername,
    timing,
    instructions: `Message stored and ${peerUsername} woken. Call await_reply(from="${peerUsername}", conversation_id="${msg.conversationId}", after_message_id=${msg.id}). Their ChatGPT will use its own tools and often takes 1–4 minutes. If peer_message is null, call await_reply again — do not tell the human they have not replied.`,
  });
}

export function createAirsupMcpServer(me: User): McpServer {
  const server = new McpServer(
    { name: "airsup", version: "3.4.0" },
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

  // Transport already requires OAuth (aso_) or legacy asp_ — do not advertise noauth
  // or ChatGPT may skip the OAuth connect step on the universal /mcp URL.
  const toolAuthMeta = {
    securitySchemes: [{ type: "oauth2" as const, scopes: ["airsup"] }],
  };

  async function openIsolatedInbox(input: {
    fromRaw: string;
    messageIdRaw?: unknown;
    extra?: McpToolExtra;
  }) {
    const parsed = parseInboxRef(input.fromRaw, input.messageIdRaw);
    if ("error" in parsed) return errorText(parsed.error);
    const match = await resolveTarget(parsed.from);
    if (!match.ok) return errorText(match.error);
    const sender = match.username;
    const messageId = parsed.messageId;
    const report = bindProgressReporter(input.extra, 100);
    await report(`Opening inbound #${messageId} from @${sender} only…`, 20);
    const inbound = await getInboundMessage({
      toUsername: me.username,
      messageId,
      fromUsername: sender,
    });
    if (!inbound) {
      logActivitySafe({
        kind: "check_inbox",
        ok: false,
        username: me.username,
        peerUsername: sender,
        httpStatus: 404,
        summary: `${me.username} check_inbox #${messageId} not in isolated thread`,
        detail: { from: sender, messageId },
      });
      return errorText(
        `No inbound #${messageId} from @${sender} for ${me.username}. Do not invent a reply. Do not open other messages.`
      );
    }
    await markDelivered(me.username, [inbound.id]).catch(() => {});
    await report(`Locked thread ${inbound.conversationId} — this message only.`, 90);
    logActivitySafe({
      kind: "check_inbox",
      ok: true,
      username: me.username,
      peerUsername: sender,
      httpStatus: 200,
      summary: `${me.username} opened isolated #${inbound.id} from ${sender}`,
      detail: {
        messageId: inbound.id,
        conversationId: inbound.conversationId,
        isolated: true,
      },
    });
    return jsonText(isolatedInboxPayload(inbound));
  }

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "Return your airsup username and display name.",
      annotations: readOnlyTool,
       _meta: toolAuthMeta,
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
       _meta: toolAuthMeta,
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
       _meta: toolAuthMeta,
    },
    async ({ username }) => {
      const domainErr = companyDomainGuard(username, "lookup_user");
      if (domainErr) {
        return jsonText({ found: false, query: username, error: domainErr });
      }
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
    "check_domains",
    {
      title: "Check company domains",
      description:
        "Check whether domains/URLs you already found (via your own search) have a live Airsup company endpoint. Not for discovering companies.",
      inputSchema: {
        domains: z
          .array(z.string())
          .describe("Domains or URLs you already found, e.g. acme.com"),
      },
      annotations: readOnlyTool,
       _meta: toolAuthMeta,
    },
    async ({ domains }) => {
      const list = await checkCompanyDomains(domains || []);
      const live = list.filter((d) => d.live);
      logActivitySafe({
        kind: "check_domains",
        ok: true,
        username: me.username,
        httpStatus: 200,
        summary: `${me.username} checked ${list.length} domain(s), ${live.length} live`,
        detail: { count: list.length, live: live.length },
      });
      return jsonText({
        domains: list,
        live_count: live.length,
      });
    }
  );

  server.registerTool(
    "talk_to_company",
    {
      title: "Talk to company AI",
      description:
        "Negotiate with a live company Airsup AI. Returns their reply in this call. Pass conversation_id for follow-ups. Not for finding companies; not talk_to_user / await_reply.",
      inputSchema: {
        domain: z.string().describe("Company domain, e.g. acme.com"),
        message: z.string().describe("What you say, negotiating as your user"),
        conversation_id: z
          .string()
          .optional()
          .describe("From a prior talk_to_company in this same negotiation"),
      },
      annotations: relayTool,
       _meta: toolAuthMeta,
    },
    async ({ domain, message, conversation_id }, extra: McpToolExtra) => {
      const body = (message || "").trim();
      const host = normalizeDomain(domain || "");
      if (!host) return errorText("domain is required");
      if (!body) return errorText("message is required");
      const convErr = companyConversationGuard(conversation_id);
      if (convErr) return errorText(convErr);
      const report = bindProgressReporter(extra, 100);
      try {
        const result = await withProgressHeartbeat(
          () =>
            talkToCompanyEndpoint({
              domain: host,
              visitorUsername: me.username,
              message: body,
              conversationId: conversation_id,
            }),
          report,
          {
            startMessage: `Talking to ${host}'s company AI…`,
            tickMessage: (timing) =>
              `Still in negotiation with ${host}… ${formatProgressTiming(timing)}`,
            startProgress: 15,
            endProgress: 88,
            typicalMinSec: 8,
            typicalMaxSec: 45,
            intervalMs: 4000,
          }
        );
        if (!result.ok) {
          return jsonText({
            ok: false,
            live: false,
            domain: host,
            error: result.error,
          });
        }
        logActivitySafe({
          kind: "talk_to_company",
          ok: true,
          username: me.username,
          peerUsername: result.company.domain,
          httpStatus: 200,
          summary: `${me.username} ↔ ${result.company.domain}`,
          detail: { conversationId: result.conversation_id },
        });
        await report(`${result.company.name} replied.`, 95);
        return jsonText({
          ok: true,
          live: true,
          channel: "company",
          company: result.company,
          domain: result.domain,
          conversation_id: result.conversation_id,
          your_message: result.your_message,
          company_message: result.company_message,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        logActivitySafe({
          kind: "talk_to_company",
          ok: false,
          username: me.username,
          peerUsername: host,
          httpStatus: 500,
          summary: `talk_to_company ${host} failed: ${err}`,
        });
        return errorText(err);
      }
    }
  );

  server.registerTool(
    "check_inbox",
    {
      title: "Open one inbound message",
      description:
        'Open exactly one inbound airsup message. Pass from as "tade1#184" from the wake line (handle#id). Do not list the inbox.',
      inputSchema: {
        from: z
          .string()
          .describe('Sender, preferably "kosti#188" (handle#id from the wake line)'),
        message_id: z
          .number()
          .optional()
          .describe("Optional if from already contains #id"),
        max_seconds: z.number().optional().describe("Ignored — kept for older ChatGPT plugin schemas"),
      },
      annotations: readOnlyTool,
       _meta: toolAuthMeta,
    },
    async ({ from, message_id }, extra: McpToolExtra) =>
      openIsolatedInbox({ fromRaw: from, messageIdRaw: message_id, extra })
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
       _meta: toolAuthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id }) => {
      const domainErr = companyDomainGuard(to, "reply_to_user");
      if (domainErr) return errorText(domainErr);
      const convErr = peerConversationGuard(conversation_id, "reply_to_user");
      if (convErr) return errorText(convErr);
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
          channel: "peer",
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
       _meta: toolAuthMeta,
    },
    async ({ to, message, conversation_id, reply_to_id }, extra: McpToolExtra) => {
      const started = Date.now();
      const requestId = newRequestId();
      const report = bindProgressReporter(extra, 100);
      const text = message.trim();
      if (!text) return errorText("message is required");

      const domainErr = companyDomainGuard(to, "talk_to_user");
      if (domainErr) return errorText(domainErr);
      const convErr = peerConversationGuard(conversation_id, "talk_to_user");
      if (convErr) return errorText(convErr);

      await report("Starting airsup message…", 1);
      await report(`Looking up ${to}…`, 5);
      const match = await resolveTarget(to);
      if (!match.ok) return errorText(match.error);
      const peer = match.user;
      if (peer.username === me.username) {
        return errorText("Cannot message yourself on Airsup.");
      }
      if (match.fuzzy) {
        await report(`Resolved "${match.resolvedFrom}" → ${peer.username}`, 8);
      }

      const continueId = (conversation_id || "").trim();
      const inboundId = Number(reply_to_id);
      if (Number.isFinite(inboundId) && inboundId > 0) {
        const inbound = await getInboundMessage({
          toUsername: me.username,
          messageId: inboundId,
          fromUsername: peer.username,
        });
        if (inbound) {
          // Peer reply in our outbound thread (parent was from us) = follow-up.
          // Must wake Orgo — replyAndAck alone only writes DB and looks "delivered".
          const parentFrom = inbound.replyToId
            ? await getMessageFromUsername(inbound.replyToId)
            : null;
          const isOutboundFollowUp =
            inbound.replyToId != null && parentFrom === me.username;

          try {
            const combined = await replyAndAckMessage({
              fromUsername: me.username,
              toUsername: peer.username,
              body: text,
              conversationId: continueId || inbound.conversationId,
              replyToId: inbound.id,
              ackId: inbound.id,
            });

            if (isOutboundFollowUp) {
              if (!orgoRelayEnabled()) {
                return errorText(
                  "Airsup Orgo relay is not configured on the server (missing ORGO_API_KEY)."
                );
              }
              if (!peer.orgoComputerId) {
                return errorText(
                  `User "${peer.username}" has no Orgo computer linked yet.`
                );
              }
              await report(`Waking ${peer.username}'s ChatGPT…`, 20);
              try {
                const wake = await wakePeerOnOrgo({
                  peerUsername: peer.username,
                  fromUsername: me.username,
                  computerId: peer.orgoComputerId,
                  conversationId: combined.message.conversationId,
                  outboundId: combined.message.id,
                  requestId,
                  report,
                });
                await markWakeSent({
                  fromUsername: me.username,
                  messageId: combined.message.id,
                });
                logActivitySafe({
                  kind: "talk",
                  ok: true,
                  username: me.username,
                  peerUsername: peer.username,
                  httpStatus: 200,
                  durationMs: Date.now() - started,
                  summary: `${me.username} → ${peer.username} (#${combined.message.id}) follow-up wake`,
                  detail: {
                    messageId: combined.message.id,
                    via: "follow_up_wake",
                    ackedInboundId: inbound.id,
                    orgoMs: wake.durationMs,
                  },
                  requestId,
                });
                return formatWakeSent(combined.message, peer.username, {
                  wake_ms: wake.durationMs,
                  total_ms: Date.now() - started,
                });
              } catch (e) {
                const err = e instanceof Error ? e.message : String(e);
                await markWakeSent({
                  fromUsername: me.username,
                  messageId: combined.message.id,
                  error: err,
                });
                return errorText(
                  `Follow-up stored (#${combined.message.id}) but Orgo wake failed: ${err}. Retry talk_to_user with conversation_id="${combined.message.conversationId}".`
                );
              }
            }

            logActivitySafe({
              kind: "reply_and_ack",
              ok: true,
              username: me.username,
              peerUsername: peer.username,
              httpStatus: 200,
              durationMs: Date.now() - started,
              summary: `${me.username} → ${peer.username} reply via talk_to_user (#${combined.message.id})`,
              detail: {
                replyId: combined.message.id,
                ackId: inbound.id,
                conversationId: inbound.conversationId,
                via: "talk_to_user_inbound",
              },
            });
            return jsonText({
              ok: true,
              channel: "peer",
              isolation: "strict",
              message: combined.message,
              acked_inbound_id: inbound.id,
              via: "api",
              next_action: "finish",
              instructions: `Reply sent to ${peer.username} on this inbound thread only.`,
            });
          } catch (e) {
            return errorText(e instanceof Error ? e.message : String(e));
          }
        }
      }

      if (!orgoRelayEnabled()) {
        return errorText(
          "Airsup Orgo relay is not configured on the server (missing ORGO_API_KEY)."
        );
      }

      if (!peer.orgoComputerId) {
        return errorText(
          `User "${peer.username}" has no Orgo computer linked yet. They need to reconnect the Airsup plugin (OAuth sets up Orgo in the same flow).`
        );
      }

      if (continueId) {
        const mustReply = await inboundFirstContactBlocksTalk({
          me: me.username,
          peer: peer.username,
          conversationId: continueId,
        });
        if (mustReply) {
          return errorText(
            `This conversation is an inbound thread from ${peer.username}. Reply with talk_to_user using reply_to_id of that inbound message. Do not start a new thread.`
          );
        }
      }

      await report(`Recording message for ${peer.username}…`, 12);
      const tSend0 = Date.now();
      const msg = await sendMessage({
        fromUsername: me.username,
        toUsername: peer.username,
        body: text,
        conversationId: continueId || undefined,
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
        await markWakeSent({ fromUsername: me.username, messageId: msg.id });
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
        await markWakeSent({
          fromUsername: me.username,
          messageId: msg.id,
          error: err,
        });
        logActivitySafe({
          kind: "orgo_wake",
          ok: false,
          username: me.username,
          peerUsername: peer.username,
          httpStatus: 502,
          durationMs: Date.now() - started,
          summary: `Orgo wake failed ${me.username} → ${peer.username}`,
          messageId: msg.id,
          computerId: peer.orgoComputerId,
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
        "Wait for a peer reply. Returns peer_status: thinking (they opened it and are working), waking, or offline.",
      inputSchema: {
        from: z.string().describe("Peer username or nickname (tade → tade1)"),
        conversation_id: z.string(),
        after_message_id: z
          .number()
          .describe("Your outbound talk_to_user message id — required so this wait cannot see other threads"),
        max_seconds: z.number().optional().describe("Max wait this call (default 120). Peer ChatGPT often needs 1–4 minutes."),
      },
      annotations: relayTool,
       _meta: toolAuthMeta,
    },
    async (args, extra: McpToolExtra) => {
      const cid = args.conversation_id.trim();
      if (!cid) return errorText("conversation_id is required");
      const convErr = peerConversationGuard(cid, "await_reply");
      if (convErr) return errorText(convErr);
      const domainErr = companyDomainGuard(args.from, "await_reply");
      if (domainErr) return errorText(domainErr);
      const afterId = Number(args.after_message_id);
      const markerId = inboundConversationMarker(cid);
      const hashed = parseInboxRef(args.from);
      if (!("error" in hashed) || markerId) {
        const fromRaw = !("error" in hashed) ? hashed.from : args.from;
        const messageIdRaw = !("error" in hashed)
          ? hashed.messageId
          : markerId ?? afterId;
        return openIsolatedInbox({ fromRaw, messageIdRaw, extra });
      }
      if (!Number.isFinite(afterId) || afterId <= 0) {
        return errorText(
          "after_message_id is required. Airsup will not wait across other conversations."
        );
      }
      const match = await resolveTarget(args.from);
      if (!match.ok) return errorText(match.error);
      const from = match.username;
      const report = bindProgressReporter(extra, 100);
      await upsertConversationWait({
        username: me.username,
        conversationId: cid,
        peerUsername: from,
        ttlMs: LIVE_AWAIT_TTL_MS,
        liveAwait: true,
      });
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
              conversationId: cid,
              afterMessageId: afterId,
            },
            { batch: true, mode: "conversation" }
          ),
        report,
        {
          startMessage: `Waiting for ${from} — their ChatGPT is using its own tools, this can take a few minutes`,
          tickMessage: async (t) => {
            const outbound = await getOutboundWait({
              fromUsername: me.username,
              messageId: afterId,
            });
            const peerStatus = describePeerWait({
              ...outbound,
              peerUsername: from,
            });
            return `${peerStatus.detail} ${formatProgressTiming(t)}`;
          },
          startProgress: 10,
          endProgress: 90,
          intervalMs: 5000,
          typicalMinSec: 5,
          typicalMaxSec: args.max_seconds ?? DEFAULT_AWAIT_MAX_SECONDS,
        }
      );
      if (result.event_count) {
        await report(`Reply received from ${from} on this thread.`, 100);
      }
      const isolated = result.events
        .filter(
          (e) =>
            e.fromUsername === from &&
            e.conversationId === cid &&
            e.id > afterId
        )
        .slice(0, 1);
      const outbound = isolated.length
        ? null
        : await getOutboundWait({
            fromUsername: me.username,
            messageId: afterId,
          });
      const peerStatus = outbound
        ? describePeerWait({ ...outbound, peerUsername: from })
        : null;
      return jsonText({
        ok: true,
        channel: "peer",
        isolation: "strict",
        conversation_id: cid,
        peer_username: from,
        after_message_id: afterId,
        peer_message: isolated[0]
          ? {
              id: isolated[0].id,
              from: isolated[0].fromUsername,
              text: isolated[0].text,
              conversation_id: isolated[0].conversationId,
              reply_to_id: isolated[0].replyToId,
            }
          : null,
        peer_status: peerStatus,
        next_action: isolated.length ? "continue_conversation" : "await_reply",
        cancel_hint: "Only call cancel_wait if the human asked to stop waiting.",
        instructions: isolated.length
          ? "This is the reply to YOUR outbound message in this conversation_id only. Ignore other threads."
          : peerStatus
            ? awaitInstructionsForPeerStatus(peerStatus, from)
            : `peer_message is null. Call await_reply again with the SAME ids.`,
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
       _meta: toolAuthMeta,
    },
    async ({ conversation_id, peer_username }) => {
      const convErr = peerConversationGuard(conversation_id, "cancel_wait");
      if (convErr) return errorText(convErr);
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
       _meta: toolAuthMeta,
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
