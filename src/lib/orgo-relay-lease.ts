/** Supabase-backed Orgo relay leases (cross-instance on Vercel). */

function supabaseLeaseConfig() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
  const token = process.env.AIRSUP_DB_TOKEN ?? "";
  if (!url || !anonKey || !token) return null;
  return { url, anonKey, token };
}

async function leaseRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const cfg = supabaseLeaseConfig();
  if (!cfg) throw new Error("Supabase not configured for Orgo leases");
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token: cfg.token, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Orgo lease RPC ${fn} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function maxConcurrentRelaysPerComputer(): number {
  const n = Number(process.env.ORGO_MAX_CONCURRENT_RELAYS || 1);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(Math.floor(n), 4));
}

function leaseTtlMs(): number {
  const orgoMs = Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000;
  return Math.max(60_000, orgoMs + 30_000);
}

const POLL_MS = 800;
const MAX_WAIT_MS = 120_000;

/** Try to acquire a distributed lease; poll until available or timeout. */
export async function acquireOrgoRelayLease(input: {
  computerId: string;
  conversationId: string;
  onWait?: (message: string) => Promise<void>;
}): Promise<{ release: () => Promise<void> }> {
  if (!supabaseLeaseConfig()) {
    return { release: async () => {} };
  }

  const started = Date.now();
  let waited = false;

  while (Date.now() - started < MAX_WAIT_MS) {
    const ok = await leaseRpc<boolean>("orgo_lease_acquire", {
      p_computer_id: input.computerId,
      p_conversation_id: input.conversationId,
      p_max_parallel: maxConcurrentRelaysPerComputer(),
      p_ttl_ms: leaseTtlMs(),
    });
    if (ok) {
      return {
        release: async () => {
          try {
            await leaseRpc("orgo_lease_release", {
              p_computer_id: input.computerId,
              p_conversation_id: input.conversationId,
            });
          } catch {
            // TTL will expire stale leases
          }
        },
      };
    }
    if (!waited) {
      waited = true;
      await input.onWait?.(
        "Another Airsup relay is active on this Orgo computer — waiting for slot…"
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw new Error("Timed out waiting for Orgo relay slot on this computer");
}

export function orgoLeaseBackend(): "supabase" | "none" {
  return supabaseLeaseConfig() ? "supabase" : "none";
}
