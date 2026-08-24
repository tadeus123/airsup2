import { NextResponse } from "next/server";
import {
  clearOauthSetupCookieHeader,
  finishRedirectUrl,
  readOauthSetupCookie,
} from "@/lib/oauth-setup";
import { getUserByUsername } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const setup = readOauthSetupCookie(request);
  if (!setup) {
    return NextResponse.json({ error: "setup session expired — reconnect the plugin" }, { status: 401 });
  }
  const user = await getUserByUsername(setup.username);
  return NextResponse.json({
    ok: true,
    username: setup.username,
    displayName: user?.displayName || setup.username,
    hasOrgo: Boolean(user?.orgoComputerId),
    aspToken: setup.aspToken,
  });
}

/** Finish OAuth — send the browser back to ChatGPT with the auth code. */
export async function POST(request: Request) {
  const setup = readOauthSetupCookie(request);
  if (!setup) {
    return NextResponse.json({ error: "setup session expired — reconnect the plugin" }, { status: 401 });
  }
  const url = finishRedirectUrl(setup);
  const res = NextResponse.json({ ok: true, redirect: url });
  res.headers.append("set-cookie", clearOauthSetupCookieHeader());
  return res;
}
