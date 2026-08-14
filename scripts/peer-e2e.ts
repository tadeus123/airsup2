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
  parsePeerHint,
  readInboxUnacked,
  registerUser,
  replyAndAckMessage,
  resolvePeerUsername,
  sendMessage,
} from "../src/lib/users";
import { filterMessages, runInboxWatch } from "../src/lib/inbox-watch";
import { buildWakePrompt, parseWakePrompt } from "../src/lib/orgo-wake-relay";
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

async function testNicknameResolve() {
  __resetUserMemoryForTests();
  await registerUser({
    username: "tade1",
    displayName: "Tade",
    orgoComputerId: "099c33f0-8459-47bb-8e4d-3b94329e2c85",
  });
  await registerUser({
    username: "kosti",
    displayName: "Kosti",
    orgoComputerId: "dca96bed-5904-4e6b-ada3-8be624df291a",
  });
  assert(parsePeerHint("tade's supi") === "tade", "parse tade's supi");
  assert(parsePeerHint("kosti2") === "kosti2", "parse kosti2");
  const tadeMatch = await resolvePeerUsername("tade");
  assert(tadeMatch.ok && tadeMatch.user.username === "tade1", "tade → tade1");
  const kostiMatch = await resolvePeerUsername("kosti2");
  assert(kostiMatch.ok && kostiMatch.user.username === "kosti", "kosti2 → kosti");
  const supiMatch = await resolvePeerUsername("tades supi");
  assert(supiMatch.ok && supiMatch.user.username === "tade1", "tades supi → tade1");
  __resetUserMemoryForTests();
}

function testWakePrompt() {
  const wake = buildWakePrompt("tade1", 140);
  assert(wake.includes("check_inbox(from=\"tade1\", message_id=140)"), "wake prompt tools");
  assert(wake.includes("#140"), "wake prompt id");
  const parsed = parseWakePrompt(wake);
  assert(parsed.fromUsername === "tade1" && parsed.messageId === 140, "parse tagged wake");
  const legacy = parseWakePrompt("@airsup kosti new message");
  assert(legacy.fromUsername === "kosti" && legacy.legacy, "parse legacy wake");
}

async function main() {
  testWakePrompt();
  await testNicknameResolve();
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

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tadeName = `tadee2e${suffix}`;
  const kostisName = `kostise2e${suffix}`;

  const tade = await registerUser({ username: tadeName, displayName: "Tade E2E" });
  const kostis = await registerUser({ username: kostisName, displayName: "Kostis E2E" });

  assert(tade.user.username === tadeName, "tade username");
  assert(kostis.user.username === kostisName, "kostis username");
  assert((await getUserByUsername(kostisName))?.username === kostisName, "lookup");

  const tadeReq = new Request("https://airsup.test/api/mcp", {
    headers: { authorization: `Bearer ${tade.token}` },
  });
  const me = await authUserFromRequest(tadeReq);
  assert(me.username === tadeName, "auth tade");

  const outbound = await sendMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
    body: "Hey Kostis — free Thursday afternoon?",
  });
  await upsertConversationWait({
    username: tadeName,
    conversationId: outbound.conversationId,
    peerUsername: kostisName,
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
  await ackMessage(kostisName, outbound.id);

  const reply = await sendMessage({
    fromUsername: kostisName,
    toUsername: tadeName,
    body: "Yes — Thursday 3pm works.",
    conversationId: outbound.conversationId,
    replyToId: outbound.id,
  });

  const scanned = filterMessages(await readInboxUnacked(tadeName), {}, { scanner: true });
  assert(!scanned.some((m) => m.id === reply.id), "scanner filter skips reply-linked");
  const byId = filterMessages(
    await readInboxUnacked(tadeName),
    { messageId: reply.id },
    { scanner: true }
  );
  assert(byId.some((m) => m.id === reply.id), "message_id fetch includes reply-linked");

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
      fromUsername: kostisName,
      conversationId: outbound.conversationId,
    },
    { batch: true, mode: "conversation" }
  );
  assert(tadeAwait.events.some((e) => e.id === reply.id), "conversation await receives reply");
  await markDelivered(tadeName, [reply.id]);

  const followUp = await sendMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
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
      fromUsername: kostisName,
      conversationId: outbound.conversationId,
      afterMessageId: followUp.id,
    },
    { batch: true, mode: "conversation" }
  );
  assert(!falseReply.events.some((e) => e.id === reply.id), "afterMessageId prevents stale replay");
  assert(falseReply.event_count === 0, "no fake instant reply");

  const combined = await replyAndAckMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
    body: "Thanks — Thursday confirmed.",
    conversationId: outbound.conversationId,
    replyToId: reply.id,
    ackId: reply.id,
  });
  assert(combined.message.id > followUp.id, "reply_and_ack sent");
  assert(combined.ack?.id === reply.id, "reply_and_ack acked");

  const cancelledMsg = await sendMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
    body: "Please ignore — cancelled",
  });
  await upsertConversationWait({
    username: tadeName,
    conversationId: cancelledMsg.conversationId,
    peerUsername: kostisName,
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  await cancelConversationWait({
    username: tadeName,
    conversationId: cancelledMsg.conversationId,
    peerUsername: kostisName,
  });
  const kostisAfterCancel = await runInboxWatch(
    kostis.user,
    { waitSeconds: 0, polls: 1, maxSeconds: 1, windowSeconds: 60 },
    { batch: true, mode: "scanner" }
  );
  assert(!kostisAfterCancel.events.some((e) => e.id === cancelledMsg.id), "scanner skips cancelled");
  assert(kostisAfterCancel.skipped_abandoned >= 1, "reports skipped_abandoned");

  const older = await sendMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
    body: "Older ask",
  });
  await upsertConversationWait({
    username: tadeName,
    conversationId: older.conversationId,
    peerUsername: kostisName,
    ttlMs: LIVE_AWAIT_TTL_MS,
    liveAwait: true,
  });
  const newer = await sendMessage({
    fromUsername: tadeName,
    toUsername: kostisName,
    body: "Newer ask",
  });
  await upsertConversationWait({
    username: tadeName,
    conversationId: newer.conversationId,
    peerUsername: kostisName,
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
  await ackMessage(kostisName, newer.id);
  await ackMessage(kostisName, older.id);

  if (!usingSupabase) {
    const staleOutbound = await sendMessage({
      fromUsername: kostisName,
      toUsername: tadeName,
      body: "old question",
    });
    await ackMessage(tadeName, staleOutbound.id);
    const staleReply = await sendMessage({
      fromUsername: kostisName,
      toUsername: tadeName,
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
    const afterSweep = await readInboxUnacked(tadeName);
    assert(!afterSweep.some((m) => m.id === staleReply.id), "stale reply-linked auto-acked");
  }

  console.log("OK peer e2e passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
