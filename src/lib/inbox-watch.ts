import {
  ackMessage,
  markDelivered,
  normalizeUsername,
  readInboxUnacked,
  type User,
  type InboxMessage,
} from "./users";
import { logActivitySafe, newRequestId } from "./activity";
import {
  getConversationWaitsBatch,
  isWaitAbandoned,
  STALE_REPLY_LINKED_MS,
  type ConversationWait,
} from "./conversation-waits";
import { StepTimer } from "./timing";
import {
  CONVERSATION_POLL_SLEEP_MS,
  DEFAULT_BATCH_MAX,
  DEFAULT_BATCH_POLLS,
  DEFAULT_WAIT_SLICE,
  DEFAULT_WINDOW,
  SCANNER_MAX_EVENTS,
  SCANNER_MAX_AGE_MS,
  SCANNER_POLL_SLEEP_MS,
  SCANNER_STALE_FIRST_CONTACT_MS,
} from "./constants";

export type WatchArgs = {
  waitSeconds?: number;
  cursor?: string | number;
  watchUntil?: string;
  windowSeconds?: number;
  reset?: boolean;
  polls?: number;
  maxSeconds?: number;
  fromUsername?: string;
  conversationId?: string;
  afterMessageId?: number;
  messageId?: number;
  maxAgeSeconds?: number;
};

export type WatchEvent = {
  id: number;
  type: "peer_message";
  at: string;
  text: string;
  fromUsername: string;
  toUsername: string;
  conversationId: string;
  replyToId: number | null;
  status: string;
  instruction: string;
};

export type WatchResult = {
  server_time: string;
  username: string;
  cursor: string;
  last_acked_hint: string;
  events: WatchEvent[];
  event_count: number;
  no_event: boolean;
  continue: boolean;
  next_action: "watch" | "finish" | "await_reply";
  remaining_seconds: number;
  watch_until: string;
  waited_seconds: number;
  polls_completed: number;
  unacked_replay: boolean;
  skipped_abandoned: number;
  skipped_reply_linked: number;
  timing: Record<string, number>;
  instructions: string;
};

const MAX_WAIT_SLICE = 28;
const MAX_WINDOW = 3600;
const MAX_BATCH_POLLS = 8;
const ABSOLUTE_BATCH_MAX = 180;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitMapKey(username: string, conversationId: string) {
  return `${normalizeUsername(username)}::${conversationId.trim()}`;
}

function toEvents(messages: InboxMessage[]): WatchEvent[] {
  return messages.map((m) => ({
    id: m.id,
    type: "peer_message" as const,
    at: m.createdAt,
    text: m.body,
    fromUsername: m.fromUsername,
    toUsername: m.toUsername,
    conversationId: m.conversationId,
    replyToId: m.replyToId,
    status: m.status,
    instruction: `Message from ${m.fromUsername}: ${m.body.slice(0, 120)}${m.body.length > 120 ? "…" : ""}`,
  }));
}

export function filterMessages(
  messages: InboxMessage[],
  args: WatchArgs,
  opts?: { scanner?: boolean }
): InboxMessage[] {
  let out = messages;
  if (args.fromUsername) {
    const fu = args.fromUsername.trim().toLowerCase();
    out = out.filter((m) => m.fromUsername === fu);
  }
  if (args.conversationId) {
    const cid = args.conversationId.trim();
    out = out.filter((m) => m.conversationId === cid);
  }
  const afterId = Number(args.afterMessageId);
  if (Number.isFinite(afterId) && afterId > 0) {
    out = out.filter((m) => m.id > afterId);
  }
  const exactId = Number(args.messageId);
  const hasExactId = Number.isFinite(exactId) && exactId > 0;
  if (hasExactId) {
    out = out.filter((m) => m.id === exactId);
  }
  if (opts?.scanner && !hasExactId) {
    out = out.filter((m) => m.replyToId == null);
    const maxAgeSec = Number(args.maxAgeSeconds);
    const maxAgeMs =
      Number.isFinite(maxAgeSec) && maxAgeSec > 0
        ? maxAgeSec * 1000
        : SCANNER_MAX_AGE_MS;
    const cutoff = Date.now() - maxAgeMs;
    out = out.filter((m) => {
      const t = Date.parse(m.createdAt);
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  return out;
}

async function loadWaitsForMessages(
  messages: InboxMessage[],
  owner: "from" | "to" | ((m: InboxMessage) => string)
): Promise<Map<string, ConversationWait>> {
  const pairs = messages.map((m) => {
    const username =
      typeof owner === "function"
        ? owner(m)
        : owner === "from"
          ? m.fromUsername
          : m.toUsername;
    return { username, conversationId: m.conversationId };
  });
  return getConversationWaitsBatch(pairs);
}

async function sweepStaleReplyLinked(me: User, timer: StepTimer): Promise<number> {
  const inbox = await readInboxUnacked(me.username);
  const now = Date.now();
  const replyLinked = inbox.filter((m) => m.replyToId != null);
  const waits = await loadWaitsForMessages(replyLinked, () => me.username);
  const staleIds: number[] = [];

  for (const m of replyLinked) {
    const ageMs = Math.max(0, now - Date.parse(m.createdAt));
    const wait = waits.get(waitMapKey(me.username, m.conversationId)) || null;
    const liveOwns =
      Boolean(wait) &&
      wait!.status === "active" &&
      wait!.liveAwait &&
      !isWaitAbandoned(wait);
    if (liveOwns) continue;
    if (isWaitAbandoned(wait) || ageMs >= STALE_REPLY_LINKED_MS) {
      staleIds.push(m.id);
    }
  }
  timer.mark("stale_reply_check_ms");

  if (!staleIds.length) return 0;
  const ackStarted = Date.now();
  for (const id of staleIds) {
    await ackMessage(me.username, id);
  }
  timer.mark("stale_reply_ack_ms");
  logActivitySafe({
    kind: "watch_skip",
    ok: true,
    username: me.username,
    httpStatus: 200,
    durationMs: Date.now() - ackStarted,
    summary: `${me.username} auto-acked ${staleIds.length} stale reply-linked inbox item(s)`,
    detail: {
      staleIds,
      reason: "stale_reply_linked_no_live_await",
      staleAfterMs: STALE_REPLY_LINKED_MS,
      timing: timer.snapshot(),
    },
  });
  return staleIds.length;
}

async function sweepStaleFirstContact(me: User, timer: StepTimer): Promise<number> {
  const inbox = await readInboxUnacked(me.username);
  const now = Date.now();
  const staleIds = inbox
    .filter((m) => m.replyToId == null)
    .filter((m) => {
      const t = Date.parse(m.createdAt);
      return Number.isFinite(t) && now - t >= SCANNER_STALE_FIRST_CONTACT_MS;
    })
    .map((m) => m.id);
  timer.mark("stale_first_contact_check_ms");
  if (!staleIds.length) return 0;
  for (const id of staleIds) {
    await ackMessage(me.username, id);
  }
  timer.mark("stale_first_contact_ack_ms");
  logActivitySafe({
    kind: "watch_skip",
    ok: true,
    username: me.username,
    httpStatus: 200,
    durationMs: 0,
    summary: `${me.username} auto-acked ${staleIds.length} stale first-contact inbox item(s)`,
    detail: {
      staleIds,
      reason: "stale_first_contact",
      staleAfterMs: SCANNER_STALE_FIRST_CONTACT_MS,
    },
  });
  return staleIds.length;
}

async function dropAbandonedForScanner(
  me: User,
  messages: InboxMessage[],
  timer: StepTimer
): Promise<{ actionable: InboxMessage[]; skippedAbandoned: number }> {
  const abandonedIds: number[] = [];
  const actionable: InboxMessage[] = [];
  const waits = await loadWaitsForMessages(messages, "from");

  for (const m of messages) {
    const wait = waits.get(waitMapKey(m.fromUsername, m.conversationId)) || null;
    // Only explicit cancel_wait skips peer delivery.
    // Expired live awaits mean the sender stopped waiting inline — the peer
    // scheduled worker must still receive and answer the message.
    if (wait?.status === "cancelled") {
      abandonedIds.push(m.id);
      continue;
    }
    actionable.push(m);
  }
  timer.mark("abandon_check_ms");

  actionable.sort((a, b) => b.id - a.id);
  const capped = actionable.slice(0, SCANNER_MAX_EVENTS);
  timer.mark("sort_cap_ms");

  if (abandonedIds.length) {
    const ackStarted = Date.now();
    for (const id of abandonedIds) {
      await ackMessage(me.username, id);
    }
    timer.mark("auto_ack_abandoned_ms");
    logActivitySafe({
      kind: "watch_skip",
      ok: true,
      username: me.username,
      httpStatus: 200,
      durationMs: Date.now() - ackStarted,
      summary: `${me.username} auto-acked ${abandonedIds.length} cancelled inbox item(s)`,
      detail: {
        abandonedIds,
        reason: "sender_cancelled_wait",
        timing: timer.snapshot(),
      },
    });
  }

  return { actionable: capped, skippedAbandoned: abandonedIds.length };
}

export async function runInboxWatch(
  me: User,
  args: WatchArgs,
  opts?: { batch?: boolean; mode?: "scanner" | "conversation" }
): Promise<WatchResult> {
  const started = Date.now();
  const timer = new StepTimer();
  const requestId = newRequestId();
  const batch = Boolean(opts?.batch);
  const conversationMode = opts?.mode === "conversation";
  const scannerMode = !conversationMode;
  const waitSeconds = clamp(
    Number(args.waitSeconds ?? DEFAULT_WAIT_SLICE),
    0,
    MAX_WAIT_SLICE
  );
  const cursorIn = Math.max(0, Number(args.cursor ?? 0) || 0);
  const windowSeconds = clamp(
    Number(args.windowSeconds ?? DEFAULT_WINDOW),
    1,
    MAX_WINDOW
  );
  const polls = batch
    ? clamp(Number(args.polls ?? DEFAULT_BATCH_POLLS), 1, MAX_BATCH_POLLS)
    : 1;
  const maxSeconds = batch
    ? clamp(Number(args.maxSeconds ?? DEFAULT_BATCH_MAX), 1, ABSOLUTE_BATCH_MAX)
    : waitSeconds;

  const now = Date.now();
  let windowUntil: number;
  if (!args.reset && args.watchUntil) {
    const parsed = Date.parse(args.watchUntil);
    windowUntil =
      Number.isFinite(parsed) && parsed > now
        ? parsed
        : now + windowSeconds * 1000;
  } else {
    windowUntil = now + windowSeconds * 1000;
  }

  const hardDeadline = Math.min(windowUntil, started + maxSeconds * 1000);

  let messages: InboxMessage[] = [];
  let pollsCompleted = 0;
  let skippedAbandoned = 0;
  let skippedReplyLinked = 0;
  let rawInboxCount = 0;

  if (scannerMode) {
    const exactId = Number(args.messageId);
    const targeting = Number.isFinite(exactId) && exactId > 0;
    if (!targeting) {
      await sweepStaleReplyLinked(me, timer);
      await sweepStaleFirstContact(me, timer);
    }
  }

  for (let i = 0; i < polls; i++) {
    pollsCompleted = i + 1;
    if (Date.now() >= hardDeadline || Date.now() >= windowUntil) break;

    const inbox = await readInboxUnacked(me.username);
    rawInboxCount = inbox.length;
    timer.mark(`inbox_read_${i}_ms`);

    const replyLinked = scannerMode
      ? inbox.filter((m) => m.replyToId != null).length
      : 0;
    skippedReplyLinked = Math.max(skippedReplyLinked, replyLinked);

    let filtered = filterMessages(inbox, args, { scanner: scannerMode });
    timer.mark(`filter_${i}_ms`);

    if (scannerMode) {
      const drop = await dropAbandonedForScanner(me, filtered, timer);
      skippedAbandoned += drop.skippedAbandoned;
      filtered = drop.actionable;
    }

    messages = filtered;
    if (messages.length > 0) break;

    const sliceMs = Math.min(
      waitSeconds * 1000,
      Math.max(0, hardDeadline - Date.now()),
      Math.max(0, windowUntil - Date.now())
    );
    if (sliceMs <= 0) break;

    const sliceDeadline = Date.now() + sliceMs;
    const pollSleep = conversationMode
      ? CONVERSATION_POLL_SLEEP_MS
      : SCANNER_POLL_SLEEP_MS;
    while (Date.now() < sliceDeadline) {
      await sleep(Math.min(pollSleep, Math.max(0, sliceDeadline - Date.now())));
      const inbox2 = await readInboxUnacked(me.username);
      rawInboxCount = inbox2.length;
      const replyLinked2 = scannerMode
        ? inbox2.filter((m) => m.replyToId != null).length
        : 0;
      skippedReplyLinked = Math.max(skippedReplyLinked, replyLinked2);
      let filtered2 = filterMessages(inbox2, args, { scanner: scannerMode });
      if (scannerMode) {
        const drop = await dropAbandonedForScanner(me, filtered2, timer);
        skippedAbandoned += drop.skippedAbandoned;
        filtered2 = drop.actionable;
      }
      messages = filtered2;
      if (messages.length > 0) break;
    }
    if (messages.length > 0) break;
  }
  timer.mark("poll_loop_ms");

  if (messages.length) {
    await markDelivered(
      me.username,
      messages.map((m) => m.id)
    );
  }
  timer.mark("mark_delivered_ms");

  const end = Date.now();
  const timing = timer.snapshot();
  const events = toEvents(messages);
  const nextCursor =
    messages.length > 0 ? Math.max(...messages.map((m) => m.id)) : cursorIn;
  const remainingMs = Math.max(0, windowUntil - end);
  const continueWatching = remainingMs > 0;
  const unackedReplay = messages.some(
    (m) => m.id <= cursorIn || m.status === "delivered"
  );

  let liveRepliesWaiting: Array<{
    id: number;
    fromUsername: string;
    conversationId: string;
  }> = [];
  if (scannerMode && messages.length === 0 && skippedReplyLinked > 0) {
    const targeting = Number.isFinite(Number(args.messageId)) && Number(args.messageId) > 0;
    if (!targeting) {
    const inboxPeek = await readInboxUnacked(me.username);
    const replyPeek = inboxPeek.filter((m) => m.replyToId != null);
    const waits = await loadWaitsForMessages(replyPeek, () => me.username);
    for (const m of replyPeek) {
      const w = waits.get(waitMapKey(me.username, m.conversationId)) || null;
      if (w && !isWaitAbandoned(w) && w.liveAwait && w.status === "active") {
        liveRepliesWaiting.push({
          id: m.id,
          fromUsername: m.fromUsername,
          conversationId: m.conversationId,
        });
      }
    }
    }
  }
  timer.mark("live_reply_hint_ms");

  const liveHint =
    liveRepliesWaiting.length > 0
      ? ` CRITICAL: ${liveRepliesWaiting.length} reply(ies) waiting for talk_to_user/await_reply. Call await_reply(from="${liveRepliesWaiting[0]!.fromUsername}", conversation_id="${liveRepliesWaiting[0]!.conversationId}").`
      : "";

  logActivitySafe({
    kind: "watch",
    ok: true,
    username: me.username,
    peerUsername: messages[0]?.fromUsername || args.fromUsername || "",
    httpStatus: 200,
    durationMs: end - started,
    summary:
      messages.length > 0
        ? `${me.username} ${batch ? "watch_batch" : "watch"} delivered ${messages.length} event(s)`
        : liveRepliesWaiting.length
          ? `${me.username} watch no_event but ${liveRepliesWaiting.length} live reply(ies) waiting`
          : `${me.username} ${batch ? "watch_batch" : "watch"} no_event`,
    detail: {
      batch,
      conversationMode,
      scannerMode,
      cursorIn,
      cursorOut: nextCursor,
      eventCount: messages.length,
      rawInboxCount,
      skippedAbandoned,
      skippedReplyLinked,
      liveRepliesWaiting,
      pollsCompleted,
      maxSeconds,
      timing,
    },
    requestId,
  });

  const continueHint = conversationMode
    ? events.length
      ? "Peer replied. Continue with talk_to_user (same conversation_id) until done."
      : "Still waiting. Call await_reply again."
    : events.length
      ? "Inbound message (internal scanner mode)."
      : `no_event.${liveHint}`;

  return {
    server_time: new Date(end).toISOString(),
    username: me.username,
    cursor: String(nextCursor),
    last_acked_hint: "Cursor advances after messages are delivered.",
    events,
    event_count: events.length,
    no_event: events.length === 0,
    continue: continueWatching,
    next_action:
      liveRepliesWaiting.length > 0
        ? "await_reply"
        : continueWatching
          ? "watch"
          : "finish",
    remaining_seconds: Math.round(remainingMs / 1000),
    watch_until: new Date(windowUntil).toISOString(),
    waited_seconds: Math.round((end - started) / 1000),
    polls_completed: pollsCompleted,
    unacked_replay: unackedReplay,
    skipped_abandoned: skippedAbandoned,
    skipped_reply_linked: skippedReplyLinked,
    timing,
    instructions: continueWatching
      ? continueHint
      : conversationMode
        ? "Wait slice ended with no reply yet. Call await_reply again with the same ids — the peer ChatGPT is likely still thinking."
        : liveRepliesWaiting.length
          ? `Monitoring window over, but live replies are waiting.${liveHint}`
          : "Monitoring window over.",
  };
}
