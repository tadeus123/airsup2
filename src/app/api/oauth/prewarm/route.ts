import { NextResponse } from "next/server";
import {
  isAllowedMcpResource,
  isAllowedRedirectUri,
  mcpResourceUrl,
  normalizeMcpResource,
  publicOrigin,
  signupForOauthPrewarm,
  OAUTH_SCOPE,
} from "@/lib/oauth";
import {
  oauthPrewarmCookieHeader,
  packOauthPrewarm,
  readOauthPrewarmCookie,
} from "@/lib/oauth-setup";
import { orgoProvisionConfigured } from "@/lib/orgo-provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PrewarmBody = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
};

export async function POST(request: Request) {
  try {
    if (!orgoProvisionConfigured()) {
      return NextResponse.json({ ok: true, skipped: "orgo_not_configured" });
    }

    const origin = publicOrigin(request);
    const body = (await request.json().catch(() => ({}))) as PrewarmBody;
    const responseType = String(body.response_type || "").trim();
    const clientId = String(body.client_id || "").trim();
    const redirectUri = String(body.redirect_uri || "").trim();
    const state = String(body.state || "").trim();
    const codeChallenge = String(body.code_challenge || "").trim();
    const codeChallengeMethod = String(body.code_challenge_method || "S256").trim();
    const scope = String(body.scope || OAUTH_SCOPE).trim();
    const resource = normalizeMcpResource(
      String(body.resource || "").trim() || mcpResourceUrl(origin),
      origin
    );

    if (responseType !== "code") {
      return NextResponse.json({ error: "response_type must be code" }, { status: 400 });
    }
    if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });
    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
      return NextResponse.json({ error: "redirect_uri not allowed" }, { status: 400 });
    }
    if (!codeChallenge) {
      return NextResponse.json({ error: "code_challenge required" }, { status: 400 });
    }
    if (codeChallengeMethod && codeChallengeMethod !== "S256") {
      return NextResponse.json({ error: "only S256 PKCE is supported" }, { status: 400 });
    }
    if (resource && !isAllowedMcpResource(resource, origin)) {
      return NextResponse.json({ error: "resource does not match this MCP server" }, { status: 400 });
    }
    void scope;

    const existing = readOauthPrewarmCookie(request);
    if (
      existing &&
      existing.clientId === clientId &&
      existing.state === state &&
      existing.redirectUri === redirectUri
    ) {
      // Re-kick Orgo warm for the same authorize attempt (idempotent).
      const { POST: startPortal } = await import("@/app/api/portal/start/route");
      await startPortal(
        new Request(`${origin}/api/portal/start`, {
          method: "POST",
          headers: { authorization: `Bearer ${existing.aspToken}` },
        })
      ).catch(() => null);
      return NextResponse.json({ ok: true, reused: true, username: existing.username });
    }

    const { user, aspToken } = await signupForOauthPrewarm();

    const packed = packOauthPrewarm({
      username: user.username,
      aspToken,
      clientId,
      redirectUri,
      state,
      issuer: origin,
    });

    // Start Orgo + open ChatGPT login while the user types their name.
    const { POST: startPortal } = await import("@/app/api/portal/start/route");
    await startPortal(
      new Request(`${origin}/api/portal/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${aspToken}` },
      })
    ).catch(() => null);

    const res = NextResponse.json({ ok: true, username: user.username });
    res.headers.append("set-cookie", oauthPrewarmCookieHeader(packed));
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
