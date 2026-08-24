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
  <title>Connect - Airsup</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg:#ffffff; --fg:#0a0a0a; --muted:rgba(10,10,10,.55);
      --border:rgba(10,10,10,.12); --cta:#0a0a0a; --cta-fg:#fff; --danger:#b42318; --radius:6px;
    }
    * { box-sizing: border-box; }
    body {
      margin:0;
      font-family: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
      background:var(--bg); color:var(--fg); line-height:1.5;
      -webkit-font-smoothing: antialiased;
    }
    .top {
      border-bottom:1px solid var(--border);
      padding:0.9rem 1.5rem;
    }
    .mark {
      font-family: Syne, "Arial Narrow", sans-serif;
      font-weight:800; letter-spacing:0.08em; text-transform:uppercase;
      font-size:1.05rem; text-decoration:none; color:inherit;
    }
    main { max-width: 28rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
    h1 {
      font-family: Syne, sans-serif; font-weight:700; font-size:1.85rem;
      letter-spacing:-0.03em; line-height:1.15; margin:0 0 .75rem;
    }
    p { color:var(--muted); margin:0 0 1rem; }
    label { display:flex; flex-direction:column; gap:.4rem; margin:1.15rem 0; }
    label span { color:var(--muted); font-size:0.82rem; font-weight:600; }
    input {
      border:1px solid var(--border); border-radius:var(--radius);
      background:#fff; font:inherit; padding:.7rem .85rem; color:inherit;
    }
    input:focus { outline:2px solid var(--fg); outline-offset:1px; border-color:transparent; }
    button[type="submit"] {
      margin-top:0.75rem; border:0; border-radius:var(--radius);
      background:var(--cta); color:var(--cta-fg); font:inherit; font-weight:600;
      padding:.7rem 1.15rem; cursor:pointer;
    }
    button[type="submit"]:hover { opacity:0.88; }
    .err { color:var(--danger); }
    .tabs { display:flex; gap:1rem; margin:1.5rem 0 .5rem; }
    .tabs button {
      border:0; background:none; font:inherit; font-weight:600; color:var(--muted);
      cursor:pointer; padding:0.35rem 0; border-bottom:2px solid transparent;
    }
    .tabs button.on { color:var(--fg); border-bottom-color:var(--fg); }
    .panel { display:none; }
    .panel.on { display:block; }
    a { color:inherit; }
  </style>
</head>
<body>
  <div class="top"><a class="mark" href="/airsup">AIRSUP</a></div>
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
  if (err) return htmlPage(`<h1>Airsup</h1><p class="err">${escapeHtml(err)}</p>`, 400);

  const hidden = qsHidden(p);
  return htmlPage(`
    <h1>Connect to Airsup</h1>
    <p>One plugin. OAuth is signup for company talks and person↔person. Keep using ChatGPT — Airsup is only the connection layer.</p>
    <div class="tabs">
      <button type="button" class="on" data-tab="new" onclick="show('new')">New account</button>
      <button type="button" data-tab="existing" onclick="show('existing')">Returning</button>
    </div>
    <form id="new" class="panel on" method="post" action="/oauth/authorize">
      ${hidden}
      <input type="hidden" name="mode" value="signup" />
      <label><span>Your name</span>
        <input name="display_name" required minlength="2" autofocus placeholder="Alex Rivera" />
      </label>
      <p>We'll create your Airsup handle — same account for company endpoints and person↔person tools. No email required.</p>
      <button type="submit">Continue</button>
    </form>
    <form id="existing" class="panel" method="post" action="/oauth/authorize">
      ${hidden}
      <input type="hidden" name="mode" value="token" />
      <label><span>Existing plugin token</span>
        <input name="asp_token" required placeholder="asp_…" autocomplete="off" spellcheck="false" />
      </label>
      <p>Paste the asp_ token from an earlier Airsup setup.</p>
      <button type="submit">Continue</button>
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
  if (err) return htmlPage(`<h1>Airsup</h1><p class="err">${escapeHtml(err)}</p>`, 400);

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
      return htmlPage(`<h1>Airsup</h1><p class="err">Unknown mode</p>`, 400);
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
      <h1>Airsup</h1>
      <p class="err">${escapeHtml(message)}</p>
      <p><a href="/oauth/authorize?${escapeHtml(retryQs)}">Try again</a></p>
      <form method="post" action="/oauth/authorize" style="display:none">${hidden}</form>
    `,
      400
    );
  }
}
