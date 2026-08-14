/** Maps Airsup usernames to Orgo computer IDs (one VM per onboarded user). */

let mapCache: Map<string, string> | null = null;

function parseComputerMap(): Map<string, string> {
  if (mapCache) return mapCache;
  mapCache = new Map();
  const raw = (process.env.ORGO_COMPUTER_MAP || "").trim();
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [username, computerId] of Object.entries(obj)) {
        const u = username.trim().toLowerCase();
        const id = computerId.trim();
        if (u && id) mapCache.set(u, id);
      }
    } catch {
      console.warn("[orgo] ORGO_COMPUTER_MAP is not valid JSON");
    }
  }
  const fallback = (process.env.ORGO_DEFAULT_COMPUTER_ID || "").trim();
  if (fallback) {
    mapCache.set("*", fallback);
  }
  return mapCache;
}

export function getOrgoComputerId(username: string): string | null {
  const map = parseComputerMap();
  const u = username.trim().toLowerCase();
  return map.get(u) ?? map.get("*") ?? null;
}

export function orgoRelayEnabled(): boolean {
  return Boolean((process.env.ORGO_API_KEY || "").trim());
}

export function __resetOrgoRoutingCacheForTests(): void {
  mapCache = null;
}
