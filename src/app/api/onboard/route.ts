import { NextResponse } from "next/server";
import { orgoSetupInstructions, pluginSetupInstructions } from "@/lib/chatgpt-onboarding";
import { logActivitySafe, newRequestId } from "@/lib/activity";
import { normalizeOrgoComputerId } from "@/lib/orgo-routing";
import {
  claimMemberNumber,
  getMemberCount,
  normalizeUsername,
  registerUser,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const count = await getMemberCount();
    return NextResponse.json({
      ok: true,
      count,
      nextNumber: count + 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stats_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: string;
      handle?: string;
      displayName?: string;
      bio?: string;
      orgoComputerId?: string;
      orgo_computer_id?: string;
    };
    const handle = normalizeUsername(body.handle || body.username || "");
    if (!handle) {
      return NextResponse.json({ error: "Choose a handle (e.g. beam)" }, { status: 400 });
    }
    if (handle.length < 2) {
      return NextResponse.json({ error: "Handle must be at least 2 characters" }, { status: 400 });
    }

    const memberNumber = await claimMemberNumber();
    const username = normalizeUsername(`${handle}${memberNumber}`);
    if (!username || username.length < 2) {
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
    }

    let orgoComputerId: string | null = null;
    const orgoRaw = (body.orgoComputerId || body.orgo_computer_id || "").trim();
    if (orgoRaw) {
      orgoComputerId = normalizeOrgoComputerId(orgoRaw);
    }

    const { user, token } = await registerUser({
      username,
      displayName: body.displayName,
      bio: body.bio,
      memberNumber,
      orgoComputerId,
    });
    const origin = new URL(request.url).origin;
    const plugin = pluginSetupInstructions({
      origin,
      username: user.username,
      token,
      user,
    });
    const orgo = orgoSetupInstructions({ username: user.username });
    logActivitySafe({
      kind: "onboard",
      ok: true,
      username: user.username,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `registered ${user.username} (#${memberNumber})`,
      detail: { mcpUrl: plugin.mcpUrl, memberNumber },
      requestId,
    });
    return NextResponse.json({
      ok: true,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      memberNumber,
      handle,
      token,
      mcpUrl: plugin.mcpUrl,
      plugin,
      orgo,
      orgoComputerId: user.orgoComputerId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "onboard_failed";
    logActivitySafe({
      kind: "onboard",
      ok: false,
      httpStatus: 400,
      durationMs: Date.now() - started,
      summary: `onboard failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
