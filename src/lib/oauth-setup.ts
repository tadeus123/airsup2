import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_SETUP_COOKIE = "airsup_oauth_setup";
const MAX_AGE_SEC = 30 * 60;

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

export function finishRedirectUrl(payload: OauthSetupPayload): string {
  const redirect = new URL(payload.redirectUri);
  redirect.searchParams.set("code", payload.code);
  if (payload.state) redirect.searchParams.set("state", payload.state);
  redirect.searchParams.set("iss", payload.issuer);
  return redirect.toString();
}
