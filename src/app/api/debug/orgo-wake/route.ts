import { NextResponse } from "next/server";

import { logActivitySafe } from "@/lib/activity";
import { getChatGptAuthState, orgoBash } from "@/lib/orgo-actions";
import { wakePeerViaOrgo } from "@/lib/orgo-wake-relay";
import {
  getUserByUsername,
  markWakeSent,
  sendMessage,
} from "@/lib/users";

export const runtime = "nodejs";
export const maxDuration = 300;

function assertProbeAuth(request: Request): string | null {
  const expected = (process.env.AIRSUP_DB_TOKEN || "").trim();
  if (!expected) return "AIRSUP_DB_TOKEN not configured";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const header = request.headers.get("x-airsup-probe-token")?.trim() || "";
  if (bearer !== expected && header !== expected) return "unauthorized";
  return null;
}

/**
 * Production probe: store a message + wake peer Orgo (CDP → agent fallback).
 * Auth: Bearer AIRSUP_DB_TOKEN
 * Body: { to, from?, body?, probeOnly? }
 */
export async function POST(request: Request) {
  const authErr = assertProbeAuth(request);
  if (authErr === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (authErr) {
    return NextResponse.json({ error: authErr }, { status: 500 });
  }

  let body: {
    to?: string;
    from?: string;
    body?: string;
    probeOnly?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const toName = (body.to || "maurice3").trim().toLowerCase();
  const fromName = (body.from || "tade-mehl3").trim().toLowerCase();
  const text =
    (body.body || "").trim() ||
    `airsup live probe ${new Date().toISOString()} — if you see this, reply via airsup`;

  const peer = await getUserByUsername(toName);
  const from = await getUserByUsername(fromName);
  if (!peer?.orgoComputerId) {
    return NextResponse.json(
      { error: `${toName} missing or has no Orgo computer` },
      { status: 404 }
    );
  }
  if (!from) {
    return NextResponse.json({ error: `${fromName} not found` }, { status: 404 });
  }

  let desktopProbe = "";
  let auth = { loggedIn: false, url: "" };
  try {
    desktopProbe = await orgoBash(
      peer.orgoComputerId,
      `set +e
export DISPLAY=:99
pgrep -af chrome | head -4 || echo NO_CHROME
curl -sS --max-time 2 http://127.0.0.1:9222/json/list 2>&1 | head -c 600
echo
echo PROBE_OK`
    );
    auth = await getChatGptAuthState(peer.orgoComputerId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        stage: "probe",
        error: msg,
        peer: { username: peer.username, orgoComputerId: peer.orgoComputerId },
      },
      { status: 502 }
    );
  }

  if (body.probeOnly) {
    return NextResponse.json({
      ok: true,
      stage: "probe",
      peer: { username: peer.username, orgoComputerId: peer.orgoComputerId },
      auth,
      desktopProbe: desktopProbe.slice(0, 1200),
    });
  }

  const started = Date.now();
  try {
    const msg = await sendMessage({
      fromUsername: from.username,
      toUsername: peer.username,
      body: text,
    });

    const wake = await wakePeerViaOrgo(peer.orgoComputerId, {
      fromUsername: from.username,
      messageId: msg.id,
      peerUsername: peer.username,
    });

    await markWakeSent({
      fromUsername: from.username,
      messageId: msg.id,
    }).catch(() => {});

    logActivitySafe({
      kind: "orgo_wake",
      ok: true,
      username: from.username,
      peerUsername: peer.username,
      messageId: msg.id,
      computerId: peer.orgoComputerId,
      durationMs: Date.now() - started,
      summary: `probe woke ${peer.username} (#${msg.id})`,
      detail: { via: "debug_orgo_wake", orgoMs: wake.durationMs },
    });

    return NextResponse.json({
      ok: true,
      stage: "wake",
      messageId: msg.id,
      conversationId: msg.conversationId,
      auth,
      orgoMs: wake.durationMs,
      totalMs: Date.now() - started,
      wakePromptHint: `@airsup inbound from ${from.username} #${msg.id}`,
      note: "Watch peer Orgo ChatGPT for the wake paste; their plugin should await_reply that id.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logActivitySafe({
      kind: "orgo_wake",
      ok: false,
      username: from.username,
      peerUsername: peer.username,
      computerId: peer.orgoComputerId,
      durationMs: Date.now() - started,
      summary: `probe wake failed ${from.username} → ${peer.username}`,
      detail: { error: msg.slice(0, 400), via: "debug_orgo_wake" },
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "wake",
        error: msg,
        auth,
        desktopProbe: desktopProbe.slice(0, 800),
        totalMs: Date.now() - started,
      },
      { status: 502 }
    );
  }
}
