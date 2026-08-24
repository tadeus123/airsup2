import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  hashUserToken,
  registerUser,
  supabaseConfig,
  supabaseRpc,
  type User,
  authUserFromRequest,
} from "./users";

export const OAUTH_SCOPE = "airsup";
export const ACCESS_TTL_SEC = 60 * 60 * 24; // 24h
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30d
export const CODE_TTL_SEC = 60 * 10; // 10m

type MemoryOAuth = {
  codes: Map<
    string,
    {
      username: string;
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      resource: string;
      scopes: string;
      expiresAt: number;
      used?: boolean;
    }
  >;
  access: Map<string, { username: string; clientId: string; resource: string; scopes: string; expiresAt: number }>;
  refresh: Map<string, { username: string; clientId: string; resource: string; scopes: string; expiresAt: number }>;
};

const g = globalThis as unknown as { __airsupOauth?: MemoryOAuth };
if (!g.__airsupOauth) {
  g.__airsupOauth = { codes: new Map(), access: new Map(), refresh: new Map() };
}
const memory = g.__airsupOauth;

export function publicOrigin(request: Request): string {
  const env = (process.env.AIRSUP_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "").replace(
    /\/$/,
    ""
  );
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    // OpenAI ChatGPT / Codex connector callbacks
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return true;
    if (host === "chat.openai.com" || host.endsWith(".openai.com")) return true;
    // Claude connectors
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return true;
    if (host === "www.claude.ai") return true;
    // Local / Cursor-style callbacks for testing
    if (host === "localhost" || host === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

function mintOpaque(prefix: string): { token: string; hash: string } {
  const token = `${prefix}${randomBytes(24).toString("hex")}`;
  return { token, hash: hashUserToken(token) };
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function storeAuthCode(input: {
  username: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scopes: string;
}): Promise<string> {
  const { token: code, hash } = mintOpaque("ac_");
  const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000);
  const cfg = supabaseConfig();
  if (cfg) {
    await supabaseRpc("oauth_store_code", {
      p_token: cfg.token,
      p_code_hash: hash,
      p_username: input.username,
      p_client_id: input.clientId,
      p_redirect_uri: input.redirectUri,
      p_code_challenge: input.codeChallenge,
      p_code_challenge_method: input.codeChallengeMethod || "S256",
      p_resource: input.resource || "",
      p_scopes: input.scopes || OAUTH_SCOPE,
      p_expires_at: expiresAt.toISOString(),
    });
  } else {
    memory.codes.set(hash, {
      username: input.username,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod || "S256",
      resource: input.resource || "",
      scopes: input.scopes || OAUTH_SCOPE,
      expiresAt: expiresAt.getTime(),
    });
  }
  return code;
}

export async function exchangeAuthCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  resource?: string;
}): Promise<{ username: string; scopes: string; resource: string }> {
  const hash = hashUserToken(input.code.trim());
  const cfg = supabaseConfig();
  let row: Record<string, unknown> | null = null;
  if (cfg) {
    row = await supabaseRpc<Record<string, unknown> | null>("oauth_consume_code", {
      p_token: cfg.token,
      p_code_hash: hash,
    });
  } else {
    const mem = memory.codes.get(hash);
    if (!mem || mem.used || mem.expiresAt < Date.now()) {
      throw new Error("invalid_grant");
    }
    mem.used = true;
    row = {
      username: mem.username,
      clientId: mem.clientId,
      redirectUri: mem.redirectUri,
      codeChallenge: mem.codeChallenge,
      codeChallengeMethod: mem.codeChallengeMethod,
      resource: mem.resource,
      scopes: mem.scopes,
    };
  }
  if (!row?.username) throw new Error("invalid_grant");
  if (String(row.clientId) !== input.clientId) throw new Error("invalid_grant");
  if (String(row.redirectUri) !== input.redirectUri) throw new Error("invalid_grant");
  const method = String(row.codeChallengeMethod || "S256");
  const challenge = String(row.codeChallenge || "");
  if (method !== "S256") throw new Error("invalid_request");
  const expected = pkceChallengeS256(input.codeVerifier);
  if (!safeEqualStr(expected, challenge)) throw new Error("invalid_grant");
  const storedResource = String(row.resource || "");
  if (input.resource && storedResource && input.resource !== storedResource) {
    throw new Error("invalid_target");
  }
  return {
    username: String(row.username),
    scopes: String(row.scopes || OAUTH_SCOPE),
    resource: storedResource || input.resource || "",
  };
}

export async function issueTokens(input: {
  username: string;
  clientId: string;
  resource: string;
  scopes: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}> {
  const access = mintOpaque("aso_");
  const refresh = mintOpaque("asr_");
  const accessExp = new Date(Date.now() + ACCESS_TTL_SEC * 1000);
  const refreshExp = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  const cfg = supabaseConfig();
  if (cfg) {
    await supabaseRpc("oauth_store_access", {
      p_token: cfg.token,
      p_token_hash: access.hash,
      p_username: input.username,
      p_client_id: input.clientId,
      p_resource: input.resource || "",
      p_scopes: input.scopes || OAUTH_SCOPE,
      p_expires_at: accessExp.toISOString(),
    });
    await supabaseRpc("oauth_store_refresh", {
      p_token: cfg.token,
      p_token_hash: refresh.hash,
      p_username: input.username,
      p_client_id: input.clientId,
      p_resource: input.resource || "",
      p_scopes: input.scopes || OAUTH_SCOPE,
      p_expires_at: refreshExp.toISOString(),
    });
  } else {
    memory.access.set(access.hash, {
      username: input.username,
      clientId: input.clientId,
      resource: input.resource || "",
      scopes: input.scopes || OAUTH_SCOPE,
      expiresAt: accessExp.getTime(),
    });
    memory.refresh.set(refresh.hash, {
      username: input.username,
      clientId: input.clientId,
      resource: input.resource || "",
      scopes: input.scopes || OAUTH_SCOPE,
      expiresAt: refreshExp.getTime(),
    });
  }
  return {
    access_token: access.token,
    refresh_token: refresh.token,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SEC,
    scope: input.scopes || OAUTH_SCOPE,
  };
}

export async function refreshTokens(input: {
  refreshToken: string;
  clientId: string;
  resource?: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}> {
  const hash = hashUserToken(input.refreshToken.trim());
  const cfg = supabaseConfig();
  let row: Record<string, unknown> | null = null;
  if (cfg) {
    row = await supabaseRpc<Record<string, unknown> | null>("oauth_consume_refresh", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
  } else {
    const mem = memory.refresh.get(hash);
    if (!mem || mem.expiresAt < Date.now()) throw new Error("invalid_grant");
    memory.refresh.delete(hash);
    row = {
      username: mem.username,
      clientId: mem.clientId,
      resource: mem.resource,
      scopes: mem.scopes,
    };
  }
  if (!row?.username) throw new Error("invalid_grant");
  if (String(row.clientId) !== input.clientId) throw new Error("invalid_grant");
  return issueTokens({
    username: String(row.username),
    clientId: input.clientId,
    resource: input.resource || String(row.resource || ""),
    scopes: String(row.scopes || OAUTH_SCOPE),
  });
}

export async function authUserFromOauthAccessToken(token: string): Promise<User | null> {
  if (!token.startsWith("aso_")) return null;
  const hash = hashUserToken(token);
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("oauth_auth_access", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
    if (!row?.username) return null;
    return {
      username: String(row.username),
      displayName: String(row.displayName ?? row.display_name ?? ""),
      bio: String(row.bio ?? ""),
      tokenPrefix: String(row.tokenPrefix ?? row.token_prefix ?? ""),
      orgoComputerId:
        row.orgoComputerId != null && String(row.orgoComputerId).trim() !== ""
          ? String(row.orgoComputerId)
          : row.orgo_computer_id != null && String(row.orgo_computer_id).trim() !== ""
            ? String(row.orgo_computer_id)
            : null,
      createdAt: row.createdAt ? String(row.createdAt) : undefined,
      updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    };
  }
  const mem = memory.access.get(hash);
  if (!mem || mem.expiresAt < Date.now()) return null;
  // Resolve full user via asp_ path is not available; build minimal from username
  // In memory mode, look up via a forged request is hard — keep username-only user.
  return {
    username: mem.username,
    displayName: mem.username,
    bio: "",
    tokenPrefix: "",
    orgoComputerId: null,
  };
}

/** Resolve Airsup user from MCP request: aso_ OAuth, asp_ legacy, or path token. */
export async function authMcpUser(request: Request): Promise<User> {
  const header = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() || "";
  if (bearer.startsWith("aso_")) {
    const user = await authUserFromOauthAccessToken(bearer);
    if (!user) throw new Error("Unauthorized");
    return user;
  }
  return authUserFromRequest(request);
}

export async function signupFromAuthorize(input: {
  displayName: string;
}): Promise<{ user: User; aspToken: string }> {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) throw new Error("name required");
  const base = displayName
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 24);
  if (base.length < 2) throw new Error("name required");
  let username = base;
  let lastErr: Error | null = null;
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? username : `${base}${i + 1}`;
    try {
      const { user, token } = await registerUser({
        username: candidate,
        displayName,
      });
      return { user, aspToken: token };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (!/taken|exists|duplicate|already/i.test(lastErr.message)) throw lastErr;
    }
  }
  throw lastErr || new Error("could not create account");
}

export async function loginWithAspToken(aspToken: string): Promise<User> {
  const forged = new Request("https://airsup.local/mcp", {
    headers: { authorization: `Bearer ${aspToken.trim()}` },
  });
  return authUserFromRequest(forged);
}
