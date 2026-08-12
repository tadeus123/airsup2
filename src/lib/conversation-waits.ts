import { normalizeUsername } from "./users";
import {
  DEFAULT_INLINE_WAIT_SECONDS,
  LIVE_AWAIT_TTL_MS,
  STALE_REPLY_LINKED_MS,
  TALK_WAIT_TTL_MS,
} from "./constants";

export type ConversationWait = {
  username: string;
  conversationId: string;
  peerUsername: string;
  status: "active" | "cancelled";
  liveAwait: boolean;
  expiresAt: string;
  updatedAt: string;
  createdAt: string;
};

export {
  TALK_WAIT_TTL_MS,
  LIVE_AWAIT_TTL_MS,
  DEFAULT_INLINE_WAIT_SECONDS,
  STALE_REPLY_LINKED_MS,
};

type MemoryWait = ConversationWait;
const memoryWaits = new Map<string, MemoryWait>();

function waitKey(username: string, conversationId: string) {
  return `${normalizeUsername(username)}::${conversationId.trim()}`;
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  const token = process.env.AIRSUP_DB_TOKEN ?? "";
  if (!url || !anonKey || !token) return null;
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

function mapWait(row: Record<string, unknown> | ConversationWait): ConversationWait {
  const r = row as Record<string, unknown>;
  return {
    username: String(r.username ?? ""),
    conversationId: String(r.conversationId ?? r.conversation_id ?? ""),
    peerUsername: String(r.peerUsername ?? r.peer_username ?? ""),
    status: (r.status === "cancelled" ? "cancelled" : "active") as
      | "active"
      | "cancelled",
    liveAwait: Boolean(r.liveAwait ?? r.live_await),
    expiresAt: String(r.expiresAt ?? r.expires_at ?? ""),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
  };
}

function isExpired(wait: ConversationWait, now = Date.now()): boolean {
  const t = Date.parse(wait.expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function isWaitAbandoned(
  wait: ConversationWait | null | undefined,
  now = Date.now()
): boolean {
  if (!wait) return false;
  if (wait.status === "cancelled") return true;
  if (wait.liveAwait && isExpired(wait, now)) return true;
  return false;
}

export async function upsertConversationWait(input: {
  username: string;
  conversationId: string;
  peerUsername: string;
  ttlMs: number;
  liveAwait?: boolean;
  cancel?: boolean;
}): Promise<ConversationWait> {
  const username = normalizeUsername(input.username);
  const peerUsername = normalizeUsername(input.peerUsername);
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("conversation_id required");
  const ttlMs = Math.max(5_000, Math.min(input.ttlMs, 24 * 60 * 60 * 1000));
  const cfg = supabaseConfig();

  if (cfg) {
    try {
      const row = await supabaseRpc<Record<string, unknown>>("wait_upsert", {
        p_token: cfg.token,
        p_username: username,
        p_conversation_id: conversationId,
        p_peer_username: peerUsername,
        p_ttl_ms: ttlMs,
        p_live_await: Boolean(input.liveAwait),
        p_cancel: Boolean(input.cancel),
      });
      if (row) return mapWait(row);
    } catch {
      // memory fallback if RPC unavailable
    }
  }

  const now = Date.now();
  const key = waitKey(username, conversationId);
  const prev = memoryWaits.get(key);
  const next: MemoryWait = {
    username,
    conversationId,
    peerUsername,
    status: input.cancel ? "cancelled" : "active",
    liveAwait: input.cancel
      ? Boolean(prev?.liveAwait || input.liveAwait)
      : Boolean(prev?.liveAwait || input.liveAwait),
    expiresAt: new Date(now + ttlMs).toISOString(),
    updatedAt: new Date(now).toISOString(),
    createdAt: prev?.createdAt || new Date(now).toISOString(),
  };
  if (input.cancel) {
    next.status = "cancelled";
    next.expiresAt = new Date(now).toISOString();
  }
  memoryWaits.set(key, next);
  return next;
}

export async function getConversationWait(
  username: string,
  conversationId: string
): Promise<ConversationWait | null> {
  const u = normalizeUsername(username);
  const cid = conversationId.trim();
  if (!cid) return null;
  const cfg = supabaseConfig();
  if (cfg) {
    try {
      const row = await supabaseRpc<Record<string, unknown> | null>("wait_get", {
        p_token: cfg.token,
        p_username: u,
        p_conversation_id: cid,
      });
      if (row) return mapWait(row);
      if (row === null) return null;
    } catch {
      // memory fallback
    }
  }
  return memoryWaits.get(waitKey(u, cid)) || null;
}

export async function getConversationWaitsBatch(
  pairs: Array<{ username: string; conversationId: string }>
): Promise<Map<string, ConversationWait>> {
  const out = new Map<string, ConversationWait>();
  const seen = new Set<string>();
  const unique: Array<{ username: string; conversationId: string }> = [];
  for (const p of pairs) {
    const username = normalizeUsername(p.username);
    const conversationId = p.conversationId.trim();
    if (!username || !conversationId) continue;
    const key = waitKey(username, conversationId);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ username, conversationId });
  }
  if (!unique.length) return out;

  const cfg = supabaseConfig();
  if (cfg) {
    try {
      const rows =
        (await supabaseRpc<Array<Record<string, unknown>>>("wait_get_many", {
          p_token: cfg.token,
          p_pairs: unique.map((u) => ({
            username: u.username,
            conversationId: u.conversationId,
          })),
        })) || [];
      for (const row of rows) {
        const w = mapWait(row);
        if (w.username && w.conversationId) {
          out.set(waitKey(w.username, w.conversationId), w);
        }
      }
      return out;
    } catch {
      // memory fallback
    }
  }

  for (const u of unique) {
    const w = memoryWaits.get(waitKey(u.username, u.conversationId));
    if (w) out.set(waitKey(u.username, u.conversationId), w);
  }
  return out;
}

export async function cancelConversationWait(input: {
  username: string;
  conversationId: string;
  peerUsername?: string;
}): Promise<ConversationWait> {
  return upsertConversationWait({
    username: input.username,
    conversationId: input.conversationId,
    peerUsername: input.peerUsername || "",
    ttlMs: 1_000,
    cancel: true,
    liveAwait: true,
  });
}

export function __resetWaitsForTests(): void {
  memoryWaits.clear();
}
