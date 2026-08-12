import { NextResponse } from "next/server";
import {
  chatgptPrefillUrl,
  pluginSetupInstructions,
  scheduledTaskDescription,
  workerSetupChatgptPrompt,
} from "@/lib/chatgpt-onboarding";
import { logActivitySafe, newRequestId } from "@/lib/activity";
import { normalizeUsername, registerUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: string;
      displayName?: string;
      bio?: string;
    };
    const username = normalizeUsername(body.username || "");
    if (!username) {
      return NextResponse.json({ error: "Choose a username (e.g. kosti)" }, { status: 400 });
    }
    const { user, token } = await registerUser({
      username,
      displayName: body.displayName,
      bio: body.bio,
    });
    const origin = new URL(request.url).origin;
    const workerPrompt = workerSetupChatgptPrompt({
      origin,
      username: user.username,
      token,
      displayName: user.displayName,
    });
    const plugin = pluginSetupInstructions({
      origin,
      username: user.username,
      token,
      user,
    });
    logActivitySafe({
      kind: "onboard",
      ok: true,
      username: user.username,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `registered ${user.username}`,
      detail: { mcpUrl: plugin.mcpUrl },
      requestId,
    });
    return NextResponse.json({
      ok: true,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      token,
      workerPrompt,
      workerChatgptUrl: chatgptPrefillUrl(workerPrompt),
      scheduleDescription: scheduledTaskDescription(user.username),
      scheduleName: `Airsup Continuous Worker - ${user.username}`,
      mcpUrl: plugin.mcpUrl,
      plugin,
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
