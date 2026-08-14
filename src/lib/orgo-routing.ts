import { getUserByUsername } from "./users";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let envMapCache: Map<string, string> | null = null;

function parseEnvComputerMap(): Map<string, string> {
  if (envMapCache) return envMapCache;
  envMapCache = new Map();
  const raw = (process.env.ORGO_COMPUTER_MAP || "").trim();
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [username, computerId] of Object.entries(obj)) {
        const u = username.trim().toLowerCase();
        const id = computerId.trim();
        if (u && id) envMapCache.set(u, id);
      }
    } catch {
      console.warn("[orgo] ORGO_COMPUTER_MAP is not valid JSON (legacy fallback)");
    }
  }
  const fallback = (process.env.ORGO_DEFAULT_COMPUTER_ID || "").trim();
  if (fallback) envMapCache.set("*", fallback);
  return envMapCache;
}

export function normalizeOrgoComputerId(raw: string): string | null {
  const id = raw.trim();
  if (!id) return null;
  if (!UUID_RE.test(id)) {
    throw new Error("Orgo computer ID must be a UUID (from Orgo General settings)");
  }
  return id;
}

/** Resolve peer username → Orgo computer ID (Supabase first, env map legacy fallback). */
export async function getOrgoComputerId(username: string): Promise<string | null> {
  const u = username.trim().toLowerCase();
  const user = await getUserByUsername(u);
  if (user?.orgoComputerId) return user.orgoComputerId;

  const map = parseEnvComputerMap();
  return map.get(u) ?? map.get("*") ?? null;
}

export function orgoRelayEnabled(): boolean {
  return Boolean((process.env.ORGO_API_KEY || "").trim());
}

export function __resetOrgoRoutingCacheForTests(): void {
  envMapCache = null;
}
