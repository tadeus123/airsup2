/**
 * Deterministic inbox protocol proof (no ChatGPT UI required).
 * Run: npm run test:e2e
 */
import {
  __backdateMessageForTests,
  __resetUserMemoryForTests,
  ackMessage,
  authUserFromRequest,
  getUserByUsername,
  markDelivered,
  readInboxUnacked,
  registerUser,
  replyAndAckMessage,
  sendMessage,
} from "../src/lib/users";
import { filterMessages, runInboxWatch } from "../src/lib/inbox-watch";
import {
  __resetWaitsForTests,
  LIVE_AWAIT_TTL_MS,
  STALE_REPLY_LINKED_MS,
  cancelConversationWait,
  upsertConversationWait,
} from "../src/lib/conversation-waits";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const usingSupabase = Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.AIRSUP_DB_TOKEN
  );
  console.log(`backend: ${usingSupabase ? "supabase" : "memory"}`);

  if (!usingSupabase) {
    __resetUserMemoryForTests();
    __resetWaitsForTests();
  }

  const tade = await registerUser({ username: "tadee2e", displayName: "Tade E2E" });
  const kostis = await registerUser({ username: "kostise2e", displayName: "Kostis E2E" });

  assert(tade.user.username === "tadee2e", "tade username");
  assert(kostis.user.username === "kostise2e", "kostis username");
  assert((await getUserByUsername("kostise2e"))?.username === "kostise2e", "lookup");

  const tadeReq = new Request("https://airsup.test/api/mcp", {
    headers: { authorization: `Bearer ${tade.token}` },
  });
  const me = await authUserFromRequest(tadeReq);
  assert(me.username === "tadee2e", "auth tade");

  const outbound = await sendMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "Hey Kostis — free Thursday afternoon?",
  });
  await upsertConversationWait({
    username: "tadee2e",
    conversationId: outbound.conversationId,
    peerUsername: "kostise2e",
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  assert(outbound.id > 0, "outbound id");

  const kostisScan = await runInboxWatch(
    kostis.user,
    { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
    { batch: true, mode: "scanner" }
  );
  assert(
    kostisScan.events.some((e) => e.id === outbound.id),
    "scanner sees new inbound"
  );
  await ackMessage("kostise2e", outbound.id);

  const reply = await sendMessage({
    fromUsername: "kostise2e",
    toUsername: "tadee2e",
    body: "Yes — Thursday 3pm works.",
    conversationId: outbound.conversationId,
    replyToId: outbound.id,
  });

  const scanned = filterMessages(await readInboxUnacked("tadee2e"), {}, { scanner: true });
  assert(!scanned.some((m) => m.id === reply.id), "scanner filter skips reply-linked");

  const tadeScan = await runInboxWatch(
    tade.user,
    { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
    { batch: true, mode: "scanner" }
  );
  assert(!tadeScan.events.some((e) => e.id === reply.id), "scanner watch skips reply-linked");

  const tadeAwait = await runInboxWatch(
    tade.user,
    {
      waitSeconds: 0,
      polls: 1,
      maxSeconds: 1,
      windowSeconds: 60,
      fromUsername: "kostise2e",
      conversationId: outbound.conversationId,
    },
    { batch: true, mode: "conversation" }
  );
  assert(tadeAwait.events.some((e) => e.id === reply.id), "conversation await receives reply");
  await markDelivered("tadee2e", [reply.id]);

  const followUp = await sendMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "One more thing — confirm Thursday?",
    conversationId: outbound.conversationId,
    replyToId: reply.id,
  });
  const falseReply = await runInboxWatch(
    tade.user,
    {
      waitSeconds: 0,
      polls: 1,
      maxSeconds: 1,
      windowSeconds: 60,
      fromUsername: "kostise2e",
      conversationId: outbound.conversationId,
      afterMessageId: followUp.id,
    },
    { batch: true, mode: "conversation" }
  );
  assert(!falseReply.events.some((e) => e.id === reply.id), "afterMessageId prevents stale replay");
  assert(falseReply.event_count === 0, "no fake instant reply");

  const combined = await replyAndAckMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "Thanks — Thursday confirmed.",
    conversationId: outbound.conversationId,
    replyToId: reply.id,
    ackId: reply.id,
  });
  assert(combined.message.id > followUp.id, "reply_and_ack sent");
  assert(combined.ack?.id === reply.id, "reply_and_ack acked");

  const cancelledMsg = await sendMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "Please ignore — cancelled",
  });
  await upsertConversationWait({
    username: "tadee2e",
    conversationId: cancelledMsg.conversationId,
    peerUsername: "kostise2e",
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  await cancelConversationWait({
    username: "tadee2e",
    conversationId: cancelledMsg.conversationId,
    peerUsername: "kostise2e",
  });
  const kostisAfterCancel = await runInboxWatch(
    kostis.user,
    { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
    { batch: true, mode: "scanner" }
  );
  assert(!kostisAfterCancel.events.some((e) => e.id === cancelledMsg.id), "scanner skips cancelled");
  assert(kostisAfterCancel.skipped_abandoned >= 1, "reports skipped_abandoned");

  const older = await sendMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "Older ask",
  });
  await upsertConversationWait({
    username: "tadee2e",
    conversationId: older.conversationId,
    peerUsername: "kostise2e",
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  const newer = await sendMessage({
    fromUsername: "tadee2e",
    toUsername: "kostise2e",
    body: "Newer ask",
  });
  await upsertConversationWait({
    username: "tadee2e",
    conversationId: newer.conversationId,
    peerUsername: "kostise2e",
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  const newestScan = await runInboxWatch(
    kostis.user,
    { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
    { batch: true, mode: "scanner" }
  );
  assert(newestScan.event_count === 1, "scanner returns one event");
  assert(newestScan.events[0]?.id === newer.id, "newest first");
  await ackMessage("kostise2e", newer.id);
  await ackMessage("kostise2e", older.id);

  if (!usingSupabase) {
    const staleOutbound = await sendMessage({
      fromUsername: "kostise2e",
      toUsername: "tadee2e",
      body: "old question",
    });
    await ackMessage("tadee2e", staleOutbound.id);
    const staleReply = await sendMessage({
      fromUsername: "kostise2e",
      toUsername: "tadee2e",
      body: "stale reply",
      conversationId: staleOutbound.conversationId,
      replyToId: staleOutbound.id,
    });
    __backdateMessageForTests(
      staleReply.id,
      new Date(Date.now() - STALE_REPLY_LINKED_MS - 60_000).toISOString()
    );
    await runInboxWatch(
      tade.user,
      { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
      { batch: true, mode: "scanner" }
    );
    const afterSweep = await readInboxUnacked("tadee2e");
    assert(!afterSweep.some((m) => m.id === staleReply.id), "stale reply-linked auto-acked");
  }

  console.log("OK peer e2e passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
