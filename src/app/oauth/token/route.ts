import {
  ACCESS_TTL_SEC,
  exchangeAuthCode,
  isAllowedRedirectUri,
  issueTokens,
  mcpResourceUrl,
  publicOrigin,
  refreshTokens,
  OAUTH_SCOPE,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "cache-control": "no-store",
  };
}

function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function oauthError(error: string, status = 400, desc?: string) {
  return Response.json(
    { error, error_description: desc || error },
    { status, headers: corsHeaders() }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const defaultResource = mcpResourceUrl(origin);
  let body: Record<string, string> = {};
  const ct = request.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      body = (await request.json()) as Record<string, string>;
    } else {
      body = formToObject(await request.formData());
    }
  } catch {
    return oauthError("invalid_request", 400, "could not parse body");
  }

  const grantType = (body.grant_type || "").trim();
  const clientId = (body.client_id || "").trim();
  if (!clientId) return oauthError("invalid_client", 401, "client_id required");

  try {
    if (grantType === "authorization_code") {
      const code = (body.code || "").trim();
      const redirectUri = (body.redirect_uri || "").trim();
      const codeVerifier = (body.code_verifier || "").trim();
      const resource = (body.resource || defaultResource).trim();
      if (!code || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", 400, "code, redirect_uri, code_verifier required");
      }
      if (!isAllowedRedirectUri(redirectUri)) {
        return oauthError("invalid_request", 400, "redirect_uri not allowed");
      }
      const exchanged = await exchangeAuthCode({
        code,
        redirectUri,
        clientId,
        codeVerifier,
        resource,
      });
      const tokens = await issueTokens({
        username: exchanged.username,
        clientId,
        resource: exchanged.resource || resource,
        scopes: exchanged.scopes || OAUTH_SCOPE,
      });
      return Response.json(
        {
          ...tokens,
          resource: exchanged.resource || resource,
        },
        { headers: corsHeaders() }
      );
    }

    if (grantType === "refresh_token") {
      const refreshToken = (body.refresh_token || "").trim();
      const resource = (body.resource || defaultResource).trim();
      if (!refreshToken) return oauthError("invalid_request", 400, "refresh_token required");
      const tokens = await refreshTokens({
        refreshToken,
        clientId,
        resource,
      });
      return Response.json(
        { ...tokens, resource, expires_in: ACCESS_TTL_SEC },
        { headers: corsHeaders() }
      );
    }

    return oauthError("unsupported_grant_type", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg === "invalid_grant" ||
      msg === "invalid_target" ||
      msg === "invalid_request"
    ) {
      return oauthError(msg, 400);
    }
    return oauthError("server_error", 500, msg);
  }
}
