import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_SETUP_COOKIE = "airsup_oauth_setup";
/** Provisional session created on the authorize Name page so Orgo can warm before Connect. */
export const OAUTH_PREWARM_COOKIE = "airsup_oauth_prewarm";
/** Set after a successful Orgo ChatGPT login so finish can return to ChatGPT even if CDP lag. */
export const CHATGPT_READY_COOKIE = "airsup_chatgpt_ready";
const MAX_AGE_SEC = 30 * 60;
const READY_MAX_AGE_SEC = 10 * 60;

export type OauthSetupPayload = {
  v: 1;
  username: string;
  aspToken: string;
  code: string;
  redirectUri: string;
  state: string;
  issuer: string;
  exp: number;
};

export type OauthPrewarmPayload = {
  v: 1;
  username: string;
  aspToken: string;
  clientId: string;
  redirectUri: string;
  state: string;
  issuer: string;
  exp: number;
};

function secret(): string {
  return process.env.AIRSUP_DB_TOKEN || "airsup-local-oauth-setup";
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function packOauthSetup(payload: Omit<OauthSetupPayload, "v" | "exp">): string {
  const full: OauthSetupPayload = {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function unpackOauthSetup(raw: string | undefined | null): OauthSetupPayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OauthSetupPayload;
    if (parsed.v !== 1) return null;
    if (!parsed.username || !parsed.aspToken || !parsed.code || !parsed.redirectUri || !parsed.issuer) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function oauthSetupCookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_SETUP_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearOauthSetupCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_SETUP_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readOauthSetupCookie(request: Request): OauthSetupPayload | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${OAUTH_SETUP_COOKIE}=([^;]+)`));
  return unpackOauthSetup(match?.[1] ? decodeURIComponent(match[1]) : null);
}

export function packOauthPrewarm(payload: Omit<OauthPrewarmPayload, "v" | "exp">): string {
  const full: OauthPrewarmPayload = {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function unpackOauthPrewarm(raw: string | undefined | null): OauthPrewarmPayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OauthPrewarmPayload;
    if (parsed.v !== 1) return null;
    if (
      !parsed.username ||
      !parsed.aspToken ||
      !parsed.clientId ||
      !parsed.redirectUri ||
      !parsed.issuer
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function oauthPrewarmCookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_PREWARM_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearOauthPrewarmCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_PREWARM_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readOauthPrewarmCookie(request: Request): OauthPrewarmPayload | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${OAUTH_PREWARM_COOKIE}=([^;]+)`));
  return unpackOauthPrewarm(match?.[1] ? decodeURIComponent(match[1]) : null);
}

export function finishRedirectUrl(payload: OauthSetupPayload): string {
  const redirect = new URL(payload.redirectUri);
  redirect.searchParams.set("code", payload.code);
  if (payload.state) redirect.searchParams.set("state", payload.state);
  redirect.searchParams.set("iss", payload.issuer);
  return redirect.toString();
}

type ChatgptReadyPayload = { v: 1; username: string; exp: number };

export function packChatgptReady(username: string): string {
  const full: ChatgptReadyPayload = {
    v: 1,
    username: username.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + READY_MAX_AGE_SEC,
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function unpackChatgptReady(raw: string | undefined | null): ChatgptReadyPayload | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ChatgptReadyPayload;
    if (parsed.v !== 1 || !parsed.username) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function chatgptReadyCookieHeader(username: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = encodeURIComponent(packChatgptReady(username));
  return `${CHATGPT_READY_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${READY_MAX_AGE_SEC}${secure}`;
}

export function clearChatgptReadyCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CHATGPT_READY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readChatgptReadyCookie(request: Request): ChatgptReadyPayload | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${CHATGPT_READY_COOKIE}=([^;]+)`));
  return unpackChatgptReady(match?.[1] ? decodeURIComponent(match[1]) : null);
}
