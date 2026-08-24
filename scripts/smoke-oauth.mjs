import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = process.env.AIRSUP_PUBLIC_ORIGIN || "https://airsup2.vercel.app";
const lines = [];
const errors = [];
const ok = (m) => lines.push(`OK ${m}`);
const bad = (m) => {
  lines.push(`FAIL ${m}`);
  errors.push(m);
};

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function main() {
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
  ]) {
    const r = await fetch(`${BASE}${path}`);
    const body = await r.text();
    if (!r.ok) bad(`${path} ${r.status} ${body.slice(0, 120)}`);
    else ok(`${path} ${r.status}`);
  }

  const as = await (
    await fetch(`${BASE}/.well-known/oauth-authorization-server`)
  ).json();
  lines.push(`AS ${JSON.stringify(as)}`);
  if (!as.authorization_endpoint?.includes("/oauth/authorize")) bad("authorize endpoint");
  if (!as.token_endpoint?.includes("/oauth/token")) bad("token endpoint");
  if (!as.client_id_metadata_document_supported) bad("cimd flag");
  if (!as.authorization_response_iss_parameter_supported)
    bad("authorization_response_iss_parameter_supported missing");
  else ok("iss parameter supported");

  const m = await fetch(`${BASE}/mcp`);
  const www = (m.headers.get("www-authenticate") || "").toLowerCase();
  if (m.status !== 401) bad(`mcp status ${m.status}`);
  else ok("mcp 401");
  if (!www.includes(["resource", "metadata"].join("_") + "="))
    bad(`www-auth missing metadata param: ${www}`);
  else ok("www-auth");
  if (!www.includes("/.well-known/oauth-protected-resource/mcp"))
    bad("www-auth should point at path-aware resource metadata");
  else ok("www-auth path-aware");

  const { verifier, challenge } = pkce();
  const redirect = "http://127.0.0.1:9/cb";
  const clientId = "https://chatgpt.com/oauth/client.json";
  const resource = `${BASE}/mcp`;
  const body = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state: "st1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "airsup",
    resource,
    mode: "signup",
    display_name: `Probe ${Date.now().toString(36)}`,
  });
  const authRes = await fetch(`${BASE}/oauth/authorize`, {
    method: "POST",
    body,
    redirect: "manual",
  });
  const loc = authRes.headers.get("location") || "";
  lines.push(`AUTH ${authRes.status} ${loc.slice(0, 200)}`);
  if (authRes.status !== 302 && authRes.status !== 303) {
    bad(`authorize ${(await authRes.text()).slice(0, 400)}`);
  } else {
    const u = new URL(loc);
    const code = u.searchParams.get("code");
    const iss = u.searchParams.get("iss");
    if (!code) bad("no code");
    else ok(`code ${code.slice(0, 12)}`);
    if (!iss) bad("iss missing on redirect");
    else if (iss !== BASE) bad(`iss mismatch ${iss}`);
    else ok(`iss ${iss}`);

    if (code) {
      const tr = await fetch(`${BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
          client_id: clientId,
          code_verifier: verifier,
          resource,
        }),
      });
      const tj = await tr.json().catch((e) => ({ e: String(e) }));
      lines.push(`TOKEN ${tr.status} ${JSON.stringify(tj).slice(0, 300)}`);
      if (!tr.ok) bad("token");
      else {
        ok("tokens");
        const init = await fetch(`${BASE}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${tj.access_token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "p", version: "0" },
            },
          }),
        });
        const it = await init.text();
        lines.push(`INIT ${init.status} ${it.slice(0, 250)}`);
        if (!init.ok) bad("init");
        else ok("init");

        const sess = init.headers.get("mcp-session-id");
        const tl = await fetch(`${BASE}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${tj.access_token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(sess ? { "mcp-session-id": sess } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        });
        const tt = await tl.text();
        lines.push(
          `TOOLS ${tl.status} check=${tt.includes("check_domains")} talk=${tt.includes("talk_to_company")} len=${tt.length}`
        );
        if (!tl.ok || !tt.includes("check_domains")) bad("tools");
        else ok("tools");

        const rr = await fetch(`${BASE}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tj.refresh_token,
            client_id: clientId,
            resource,
          }),
        });
        const rj = await rr.json().catch(() => ({}));
        lines.push(`REFRESH ${rr.status} ${JSON.stringify(rj).slice(0, 200)}`);
        if (!rr.ok) bad("refresh");
        else ok("refresh");
      }
    }
  }

  const chatgptRedirect = "https://chatgpt.com/connector_platform_oauth_redirect";
  // just validate allowlist via authorize GET
  const allow = await fetch(
    `${BASE}/oauth/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: chatgptRedirect,
        state: "x",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource,
      })
  );
  const allowText = await allow.text();
  if (allow.ok && /new account/i.test(allowText)) ok("chatgpt redirect allowed");
  else bad(`chatgpt redirect blocked ${allow.status}`);

  const evil = await fetch(
    `${BASE}/oauth/authorize?` +
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://evil.com/cb",
        state: "x",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource,
      })
  );
  const evilText = await evil.text();
  if (evilText.toLowerCase().includes("not allowed") || evil.status >= 400)
    ok("evil redirect blocked");
  else bad("evil redirect not blocked");

  for (const p of ["/company", "/portal", "/airsup"]) {
    const r = await fetch(`${BASE}${p}`);
    if (!r.ok) bad(`${p} ${r.status}`);
    else ok(p);
  }

  lines.push(`ERRORS ${errors.length}`);
  lines.push(...errors);
  writeFileSync("smoke-oauth.txt", lines.join("\n"));
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  writeFileSync("smoke-oauth.txt", String(e && e.stack ? e.stack : e));
  process.exit(1);
});
