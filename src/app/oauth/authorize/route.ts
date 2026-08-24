import { NextResponse } from "next/server";
import {
  isAllowedMcpResource,
  isAllowedRedirectUri,
  loginWithAspToken,
  mcpResourceUrl,
  normalizeMcpResource,
  publicOrigin,
  signupFromAuthorize,
  storeAuthCode,
  OAUTH_SCOPE,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlPage(body: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>airsup · connect</title>
  <style>
    :root { --bg:#efe8dc; --fg:#1a1a1a; --accent:#a85a2a; --muted:#6b6560; --border:rgba(26,26,26,.18); }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; background:var(--bg); color:var(--fg); }
    main { max-width: 28rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    h1 { font-weight:400; font-size:1.75rem; color:var(--accent); margin:0 0 .5rem; }
    p { color:var(--muted); line-height:1.45; }
    label { display:flex; flex-direction:column; gap:.35rem; margin:1.25rem 0; }
    label span { color:var(--accent); }
    input { border:0; border-bottom:1px solid var(--border); background:transparent; font:inherit; padding:.45rem 0; color:inherit; }
    input:focus { outline:none; border-bottom-color:var(--accent); }
    button { margin-top:1rem; border:0; background:none; font:inherit; color:var(--accent); text-decoration:underline; text-underline-offset:.18em; cursor:pointer; padding:0; }
    .err { color:#8b1e1e; }
    .tabs { display:flex; gap:1.25rem; margin:1.5rem 0 .5rem; }
    .tabs button { text-decoration:none; color:var(--muted); }
    .tabs button.on { color:var(--accent); text-decoration:underline; }
    .panel { display:none; }
    .panel.on { display:block; }
    a { color:var(--accent); }
  </style>
</head>
<body>
  <main>${body}</main>
  <script>
    function show(id) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('on'));
      document.getElementById(id)?.classList.add('on');
      document.querySelector('[data-tab="'+id+'"]')?.classList.add('on');
    }
  </script>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

function parseAuthorizeParams(url: URL) {
  return {
    responseType: (url.searchParams.get("response_type") || "").trim(),
    clientId: (url.searchParams.get("client_id") || "").trim(),
    redirectUri: (url.searchParams.get("redirect_uri") || "").trim(),
    state: (url.searchParams.get("state") || "").trim(),
    codeChallenge: (url.searchParams.get("code_challenge") || "").trim(),
    codeChallengeMethod: (url.searchParams.get("code_challenge_method") || "S256").trim(),
    scope: (url.searchParams.get("scope") || OAUTH_SCOPE).trim(),
    resource: (url.searchParams.get("resource") || "").trim(),
  };
}

function validateAuthorize(p: ReturnType<typeof parseAuthorizeParams>, origin: string) {
  if (p.responseType !== "code") return "response_type must be code";
  if (!p.clientId) return "client_id required";
  if (!p.redirectUri) return "redirect_uri required";
  if (!isAllowedRedirectUri(p.redirectUri)) return "redirect_uri not allowed";
  if (!p.codeChallenge) return "code_challenge required (PKCE)";
  if (p.codeChallengeMethod && p.codeChallengeMethod !== "S256") {
    return "only S256 PKCE is supported";
  }
  if (p.resource && !isAllowedMcpResource(p.resource, origin)) {
    return "resource does not match this MCP server";
  }
  return null;
}

function qsHidden(p: ReturnType<typeof parseAuthorizeParams>) {
  const entries: Array<[string, string]> = [
    ["response_type", p.responseType],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["state", p.state],
    ["code_challenge", p.codeChallenge],
    ["code_challenge_method", p.codeChallengeMethod || "S256"],
    ["scope", p.scope || OAUTH_SCOPE],
    ["resource", p.resource],
  ];
  return entries
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`
    )
    .join("\n");
}

function authorizeQuery(p: ReturnType<typeof parseAuthorizeParams>): string {
  const q = new URLSearchParams();
  if (p.responseType) q.set("response_type", p.responseType);
  if (p.clientId) q.set("client_id", p.clientId);
  if (p.redirectUri) q.set("redirect_uri", p.redirectUri);
  if (p.state) q.set("state", p.state);
  if (p.codeChallenge) q.set("code_challenge", p.codeChallenge);
  if (p.codeChallengeMethod) q.set("code_challenge_method", p.codeChallengeMethod);
  if (p.scope) q.set("scope", p.scope);
  if (p.resource) q.set("resource", p.resource);
  return q.toString();
}

function redirectWithCode(input: {
  redirectUri: string;
  code: string;
  state: string;
  issuer: string;
}) {
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set("code", input.code);
  if (input.state) redirect.searchParams.set("state", input.state);
  // RFC 9207 — ChatGPT rejects the response if iss is advertised but missing
  redirect.searchParams.set("iss", input.issuer);
  return NextResponse.redirect(redirect.toString(), 302);
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const url = new URL(request.url);
  const p = parseAuthorizeParams(url);
  if (!p.resource) p.resource = mcpResourceUrl(origin);
  else p.resource = normalizeMcpResource(p.resource, origin);
  const err = validateAuthorize(p, origin);
  if (err) return htmlPage(`<h1>airsup</h1><p class="err">${escapeHtml(err)}</p>`, 400);

  const hidden = qsHidden(p);
  return htmlPage(`
    <h1>airsup</h1>
    <p>connect ChatGPT to Airsup. this is your signup — one plugin for people and company talks.</p>
    <div class="tabs">
      <button type="button" class="on" data-tab="new" onclick="show('new')">new account</button>
      <button type="button" data-tab="existing" onclick="show('existing')">returning</button>
    </div>
    <form id="new" class="panel on" method="post" action="/oauth/authorize">
      ${hidden}
      <input type="hidden" name="mode" value="signup" />
      <label><span>your name</span>
        <input name="display_name" required minlength="2" autofocus placeholder="Tade Mehl" />
      </label>
      <p>we'll create your airsup handle. no email.</p>
      <button type="submit">continue</button>
    </form>
    <form id="existing" class="panel" method="post" action="/oauth/authorize">
      ${hidden}
      <input type="hidden" name="mode" value="token" />
      <label><span>existing plugin token</span>
        <input name="asp_token" required placeholder="asp_…" autocomplete="off" spellcheck="false" />
      </label>
      <p>paste the asp_ token from an earlier airsup setup.</p>
      <button type="submit">continue</button>
    </form>
  `);
}

export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const form = await request.formData();
  const get = (k: string) => String(form.get(k) || "").trim();
  const p = {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    state: get("state"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method") || "S256",
    scope: get("scope") || OAUTH_SCOPE,
    resource: normalizeMcpResource(get("resource") || mcpResourceUrl(origin), origin),
  };
  const err = validateAuthorize(p, origin);
  if (err) return htmlPage(`<h1>airsup</h1><p class="err">${escapeHtml(err)}</p>`, 400);

  const mode = get("mode");
  try {
    let username = "";
    if (mode === "signup") {
      const { user } = await signupFromAuthorize({ displayName: get("display_name") });
      username = user.username;
    } else if (mode === "token") {
      const user = await loginWithAspToken(get("asp_token"));
      username = user.username;
    } else {
      return htmlPage(`<h1>airsup</h1><p class="err">unknown mode</p>`, 400);
    }

    const code = await storeAuthCode({
      username,
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      codeChallengeMethod: p.codeChallengeMethod,
      resource: p.resource,
      scopes: p.scope.includes(OAUTH_SCOPE) ? OAUTH_SCOPE : p.scope || OAUTH_SCOPE,
    });

    return redirectWithCode({
      redirectUri: p.redirectUri,
      code,
      state: p.state,
      issuer: origin,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hidden = qsHidden(p);
    const retryQs = authorizeQuery(p);
    return htmlPage(
      `
      <h1>airsup</h1>
      <p class="err">${escapeHtml(message)}</p>
      <p><a href="/oauth/authorize?${escapeHtml(retryQs)}">try again</a></p>
      <form method="post" action="/oauth/authorize" style="display:none">${hidden}</form>
    `,
      400
    );
  }
}
