import { createHash, randomBytes } from "node:crypto";
import { AUTH_CACHE_TTL_MS } from "./constants";

export type User = {
  username: string;
  displayName: string;
  bio: string;
  tokenPrefix: string;
  orgoComputerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type InboxMessage = {
  id: number;
  conversationId: string;
  fromUsername: string;
  toUsername: string;
  body: string;
  status: "pending" | "delivered" | "acked";
  replyToId: number | null;
  createdAt: string;
};

type MemoryUser = User & { tokenHash: string };
type MemoryStore = {
  users: Map<string, MemoryUser>;
  byHash: Map<string, string>;
  messages: InboxMessage[];
  seq: number;
};

const memory: MemoryStore = {
  users: new Map(),
  byHash: new Map(),
  messages: [],
  seq: 0,
};

const authCache = new Map<string, { user: User; expiresAt: number }>();

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  const token = process.env.AIRSUP_DB_TOKEN ?? "";
  if (!url || !anonKey || !token) {
    const mustHaveDb =
      Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
    if (mustHaveDb) {
      throw new Error(
        "Database not configured (missing SUPABASE_URL, SUPABASE_ANON_KEY, or AIRSUP_DB_TOKEN)"
      );
    }
    return null;
  }
  return { url, anonKey, token };
}

async function supabaseRpc<T>(
  fn: string,
  body: Record<string, unknown>
): Promise<T | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const response = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.anonKey,
      authorization: `Bearer ${cfg.anonKey}`,
    },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json &&
        typeof json === "object" &&
        "message" in json &&
        String((json as { message: string }).message)) ||
      `Supabase RPC ${fn} failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40);
}

export function hashUserToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintUserToken(): { token: string; hash: string; prefix: string } {
  const token = `asp_${randomBytes(24).toString("hex")}`;
  return {
    token,
    hash: hashUserToken(token),
    prefix: token.slice(0, 10),
  };
}

function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  const url = new URL(request.url);
  const pathToken = url.pathname.match(/\/(?:api\/)?mcp\/(asp_[a-f0-9]+)\/?$/i)?.[1];
  return (
    request.headers.get("x-airsup-token") ||
    url.searchParams.get("token") ||
    pathToken ||
    ""
  ).trim();
}

function mapUser(row: Record<string, unknown>): User {
  const orgoRaw = row.orgoComputerId ?? row.orgo_computer_id;
  return {
    username: String(row.username ?? ""),
    displayName: String(row.displayName ?? row.display_name ?? ""),
    bio: String(row.bio ?? ""),
    tokenPrefix: String(row.tokenPrefix ?? row.token_prefix ?? ""),
    orgoComputerId:
      orgoRaw != null && String(orgoRaw).trim() !== ""
        ? String(orgoRaw).trim()
        : null,
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
  };
}

function mapMessage(row: Record<string, unknown>): InboxMessage {
  return {
    id: Number(row.id),
    conversationId: String(row.conversationId ?? row.conversation_id ?? ""),
    fromUsername: String(row.fromUsername ?? row.from_username ?? ""),
    toUsername: String(row.toUsername ?? row.to_username ?? ""),
    body: String(row.body ?? ""),
    status: (row.status as InboxMessage["status"]) || "pending",
    replyToId:
      row.replyToId != null
        ? Number(row.replyToId)
        : row.reply_to_id != null
          ? Number(row.reply_to_id)
          : null,
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  };
}

export async function getMemberCount(): Promise<number> {
  const cfg = supabaseConfig();
  if (cfg) {
    const n = await supabaseRpc<number>("ainet_member_count", {
      p_token: cfg.token,
    });
    return Number(n ?? 0);
  }
  return memory.users.size;
}

export async function claimMemberNumber(): Promise<number> {
  const cfg = supabaseConfig();
  if (cfg) {
    const n = await supabaseRpc<number>("ainet_claim_member_number", {
      p_token: cfg.token,
    });
    const num = Number(n ?? 0);
    if (!num) throw new Error("Failed to claim member number");
    return num;
  }
  return memory.users.size + 1;
}

export async function registerUser(input: {
  username?: string;
  displayName?: string;
  bio?: string;
  memberNumber?: number;
  orgoComputerId?: string | null;
}): Promise<{ user: User; token: string; memberNumber?: number }> {
  const username = normalizeUsername(input.username || "");
  if (!username) throw new Error("Username is required");
  if (username.length < 2) throw new Error("Username must be at least 2 characters");
  const displayName = (input.displayName || username).trim();
  const bio = (input.bio || "").trim();
  const minted = mintUserToken();
  const memberNumber = input.memberNumber;

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("user_register", {
      p_token: cfg.token,
      p_username: username,
      p_display_name: displayName,
      p_token_hash: minted.hash,
      p_token_prefix: minted.prefix,
      p_bio: bio,
      p_member_number: memberNumber ?? null,
      p_orgo_computer_id: input.orgoComputerId ?? null,
    });
    if (!row?.username) throw new Error("Failed to register user");
    return {
      user: mapUser(row),
      token: minted.token,
      memberNumber: row.memberNumber != null ? Number(row.memberNumber) : memberNumber,
    };
  }

  if (memory.users.has(username)) {
    throw new Error("username taken");
  }

  const user: MemoryUser = {
    username,
    displayName,
    bio,
    tokenPrefix: minted.prefix,
    orgoComputerId: input.orgoComputerId ?? null,
    tokenHash: minted.hash,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  memory.users.set(username, user);
  memory.byHash.set(minted.hash, username);
  return {
    user: {
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      tokenPrefix: user.tokenPrefix,
      orgoComputerId: user.orgoComputerId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    token: minted.token,
    memberNumber,
  };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const u = normalizeUsername(username);
  if (!u) return null;
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("user_get", {
      p_token: cfg.token,
      p_username: u,
    });
    return row ? mapUser(row) : null;
  }
  const user = memory.users.get(u);
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    tokenPrefix: user.tokenPrefix,
    orgoComputerId: user.orgoComputerId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function setOrgoComputerForUsername(input: {
  username: string;
  orgoComputerId: string | null;
}): Promise<User> {
  const uname = normalizeUsername(input.username);
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>(
      "user_set_orgo_computer_admin",
      {
        p_token: cfg.token,
        p_username: uname,
        p_orgo_computer_id: input.orgoComputerId ?? "",
      }
    );
    if (!row?.username) throw new Error("Failed to save Orgo computer ID");
    return mapUser(row);
  }
  const mem = memory.users.get(uname);
  if (!mem) throw new Error("unknown username");
  mem.orgoComputerId = input.orgoComputerId;
  mem.updatedAt = new Date().toISOString();
  return {
    username: mem.username,
    displayName: mem.displayName,
    bio: mem.bio,
    tokenPrefix: mem.tokenPrefix,
    orgoComputerId: mem.orgoComputerId,
    createdAt: mem.createdAt,
    updatedAt: mem.updatedAt,
  };
}

export async function setOrgoComputerForToken(input: {
  token: string;
  orgoComputerId: string | null;
}): Promise<User> {
  const hash = hashUserToken(input.token);
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("user_set_orgo_computer", {
      p_token: cfg.token,
      p_token_hash: hash,
      p_orgo_computer_id: input.orgoComputerId ?? "",
    });
    if (!row?.username) throw new Error("Failed to save Orgo computer ID");
    authCache.delete(hash);
    return mapUser(row);
  }
  const username = memory.byHash.get(hash);
  if (!username) throw new Error("Unauthorized");
  const mem = memory.users.get(username);
  if (!mem) throw new Error("Unauthorized");
  mem.orgoComputerId = input.orgoComputerId;
  mem.updatedAt = new Date().toISOString();
  return {
    username: mem.username,
    displayName: mem.displayName,
    bio: mem.bio,
    tokenPrefix: mem.tokenPrefix,
    orgoComputerId: mem.orgoComputerId,
    createdAt: mem.createdAt,
    updatedAt: mem.updatedAt,
  };
}

export async function listUsers(input?: {
  query?: string;
  limit?: number;
}): Promise<Array<{ username: string; displayName: string; bio: string }>> {
  const cfg = supabaseConfig();
  if (cfg) {
    const rows =
      (await supabaseRpc<Array<Record<string, unknown>>>("users_list", {
        p_token: cfg.token,
        p_query: input?.query ?? "",
        p_limit: input?.limit ?? 50,
      })) || [];
    return rows.map((r) => ({
      username: String(r.username),
      displayName: String(r.displayName ?? r.display_name ?? r.username),
      bio: String(r.bio ?? ""),
    }));
  }
  const q = (input?.query || "").trim().toLowerCase();
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  return [...memory.users.values()]
    .filter((u) => !!u.orgoComputerId)
    .filter(
      (u) =>
        !q ||
        u.username.includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.bio.toLowerCase().includes(q)
    )
    .slice(0, limit)
    .map((u) => ({
      username: u.username,
      displayName: u.displayName,
      bio: u.bio,
    }));
}

export async function authUserFromRequest(request: Request): Promise<User> {
  const token = extractBearer(request);
  if (!token) throw new Error("Unauthorized");
  const hash = hashUserToken(token);

  const cached = authCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("user_auth", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
    if (!row?.username) throw new Error("Unauthorized");
    const user = mapUser(row);
    authCache.set(hash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    return user;
  }
  const username = memory.byHash.get(hash);
  if (!username) throw new Error("Unauthorized");
  const mem = memory.users.get(username);
  if (!mem) throw new Error("Unauthorized");
  const user = {
    username: mem.username,
    displayName: mem.displayName,
    bio: mem.bio,
    tokenPrefix: mem.tokenPrefix,
    createdAt: mem.createdAt,
    updatedAt: mem.updatedAt,
  };
  authCache.set(hash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
}

export async function sendMessage(input: {
  fromUsername: string;
  toUsername: string;
  body: string;
  conversationId?: string;
  replyToId?: number | null;
}): Promise<InboxMessage> {
  const fromUsername = normalizeUsername(input.fromUsername);
  const toUsername = normalizeUsername(input.toUsername);
  const body = input.body.trim();
  if (!body) throw new Error("Message body is required");

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("message_send", {
      p_token: cfg.token,
      p_from: fromUsername,
      p_to: toUsername,
      p_body: body,
      p_conversation_id: input.conversationId || "",
      p_reply_to_id: input.replyToId ?? null,
    });
    if (!row?.id) throw new Error("Send failed");
    return mapMessage(row);
  }

  if (!memory.users.has(fromUsername)) throw new Error("unknown from username");
  if (!memory.users.has(toUsername)) throw new Error("unknown to username");
  memory.seq += 1;
  const msg: InboxMessage = {
    id: memory.seq,
    conversationId: input.conversationId || `mem_${memory.seq}`,
    fromUsername,
    toUsername,
    body,
    status: "pending",
    replyToId: input.replyToId ?? null,
    createdAt: new Date().toISOString(),
  };
  memory.messages.push(msg);
  return msg;
}

/** Returns all pending + delivered (unacked). Cursor ignored for correctness. */
export async function readInboxUnacked(username: string): Promise<InboxMessage[]> {
  const u = normalizeUsername(username);
  const cfg = supabaseConfig();
  if (cfg) {
    const rows =
      (await supabaseRpc<Array<Record<string, unknown>>>("inbox_unacked", {
        p_token: cfg.token,
        p_username: u,
      })) || [];
    return rows.map(mapMessage);
  }
  return memory.messages.filter(
    (m) =>
      m.toUsername === u &&
      (m.status === "pending" || m.status === "delivered")
  );
}

export async function markDelivered(username: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const u = normalizeUsername(username);
  const cfg = supabaseConfig();
  if (cfg) {
    await supabaseRpc("message_mark_delivered", {
      p_token: cfg.token,
      p_username: u,
      p_ids: ids,
    });
    return;
  }
  for (const msg of memory.messages) {
    if (msg.toUsername === u && ids.includes(msg.id) && msg.status === "pending") {
      msg.status = "delivered";
    }
  }
}

export async function ackMessage(
  username: string,
  messageId: number
): Promise<{ id: number; status: string; ackedAt?: string } | null> {
  const u = normalizeUsername(username);
  const cfg = supabaseConfig();
  if (cfg) {
    return await supabaseRpc("message_ack", {
      p_token: cfg.token,
      p_username: u,
      p_message_id: messageId,
    });
  }
  const msg = memory.messages.find((m) => m.id === messageId && m.toUsername === u);
  if (!msg) return null;
  msg.status = "acked";
  return { id: msg.id, status: "acked", ackedAt: new Date().toISOString() };
}

export async function replyAndAckMessage(input: {
  fromUsername: string;
  toUsername: string;
  body: string;
  conversationId: string;
  replyToId: number;
  ackId: number;
}): Promise<{
  message: InboxMessage;
  ack: { id: number; status: string; ackedAt?: string } | null;
}> {
  const fromUsername = normalizeUsername(input.fromUsername);
  const toUsername = normalizeUsername(input.toUsername);
  const body = input.body.trim();
  const conversationId = input.conversationId.trim();
  const replyToId = Number(input.replyToId);
  const ackId = Number(input.ackId);
  if (!body) throw new Error("Message body is required");
  if (!conversationId) throw new Error("conversation_id required");
  if (!Number.isFinite(replyToId) || replyToId <= 0) {
    throw new Error("reply_to_id required");
  }
  if (!Number.isFinite(ackId) || ackId <= 0) {
    throw new Error("ack_id required");
  }

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<{
      message?: Record<string, unknown>;
      ack?: { id: number; status: string; ackedAt?: string } | null;
    }>("message_reply_and_ack", {
      p_token: cfg.token,
      p_from: fromUsername,
      p_to: toUsername,
      p_body: body,
      p_conversation_id: conversationId,
      p_reply_to_id: replyToId,
      p_ack_id: ackId,
    });
    if (!row?.message?.id) throw new Error("Reply failed");
    return {
      message: mapMessage(row.message),
      ack: row.ack?.id
        ? {
            id: Number(row.ack.id),
            status: String(row.ack.status),
            ackedAt: row.ack.ackedAt,
          }
        : null,
    };
  }

  const message = await sendMessage({
    fromUsername,
    toUsername,
    body,
    conversationId,
    replyToId,
  });
  const ack = await ackMessage(fromUsername, ackId);
  return { message, ack };
}

export function __resetUserMemoryForTests(): void {
  memory.users.clear();
  memory.byHash.clear();
  memory.messages = [];
  memory.seq = 0;
  authCache.clear();
}

export function __backdateMessageForTests(id: number, createdAtIso: string): void {
  const msg = memory.messages.find((m) => m.id === id);
  if (msg) msg.createdAt = createdAtIso;
}
