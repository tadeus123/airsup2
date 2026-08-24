import { NextResponse } from "next/server";
import {
  clearOauthSetupCookieHeader,
  finishRedirectUrl,
  readOauthSetupCookie,
} from "@/lib/oauth-setup";
import { getChatGptAuthState, orgoProvisionConfigured } from "@/lib/orgo-provision";
import { authPortalUser } from "@/lib/portal-auth";
import { getUserByUsername } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const setup = readOauthSetupCookie(request);
  if (!setup) {
    return NextResponse.json({ error: "setup session expired — reconnect the plugin" }, { status: 401 });
  }
  const user = await getUserByUsername(setup.username);
  let loggedIn = false;
  if (orgoProvisionConfigured() && user?.orgoComputerId) {
    try {
      const state = await getChatGptAuthState(user.orgoComputerId);
      loggedIn = state.loggedIn;
    } catch {
      loggedIn = false;
    }
  }
  return NextResponse.json({
    ok: true,
    username: setup.username,
    displayName: user?.displayName || setup.username,
    hasOrgo: Boolean(user?.orgoComputerId),
    loggedIn,
    aspToken: setup.aspToken,
  });
}

/** Finish OAuth — send the browser back to ChatGPT with the auth code. */
export async function POST(request: Request) {
  const setup = readOauthSetupCookie(request);
  if (!setup) {
    return NextResponse.json({ error: "setup session expired — reconnect the plugin" }, { status: 401 });
  }

  if (orgoProvisionConfigured()) {
    try {
      const user = await authPortalUser(setup.aspToken);
      const computerId = (user.orgoComputerId || "").trim();
      if (!computerId) {
        return NextResponse.json(
          { error: "Desktop not ready — wait a moment and try again" },
          { status: 400 }
        );
      }
      const state = await getChatGptAuthState(computerId);
      if (!state.loggedIn) {
        return NextResponse.json(
          { error: "Sign into ChatGPT before continuing" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Could not verify ChatGPT login — try again" },
        { status: 400 }
      );
    }
  }

  const url = finishRedirectUrl(setup);
  const res = NextResponse.json({ ok: true, redirect: url });
  res.headers.append("set-cookie", clearOauthSetupCookieHeader());
  return res;
}
