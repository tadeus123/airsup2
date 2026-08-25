/**
 * Tail Airsup ops events while you demo (OAuth, MCP, company go-live).
 * Usage: node --env-file=.env.local scripts/watch-live.mjs
 */
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_ANON_KEY;
const token = process.env.AIRSUP_DB_TOKEN;
const pollMs = Number(process.env.WATCH_POLL_MS || 4000) || 4000;

if (!url || !key || !token) {
  console.error("Need SUPABASE_URL, SUPABASE_ANON_KEY, AIRSUP_DB_TOKEN");
  process.exit(1);
}

let afterId = 0;
const started = Date.now();

function fmt(row) {
  const t = new Date(row.created_at).toISOString().slice(11, 19);
  const who = row.username
    ? row.peer_username
      ? `${row.username}→${row.peer_username}`
      : row.username
    : "—";
  const flag = row.ok === false || row.severity === "error" ? " FAIL" : "";
  return `[${t}] #${row.id} ${row.kind}${flag} ${who}: ${row.summary}`;
}

async function tailOnce() {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/airsup_events_tail`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_token: token, p_after_id: afterId, p_limit: 80 }),
    });
    const raw = await r.text();
    if (!r.ok) {
      if (raw.includes("airsup_events_tail") && raw.includes("does not exist")) {
        console.error(
          "airsup_events_tail RPC missing — apply migration 016_airsup_events_tail.sql first"
        );
        process.exit(2);
      }
      console.error("tail failed", r.status, raw.slice(0, 200));
      return;
    }
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) return;
    for (const row of rows) {
      afterId = Math.max(afterId, Number(row.id) || 0);
      console.log(fmt(row));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("tail error (will retry):", msg.slice(0, 160));
  }
}

console.log("Airsup live watch — polling every", pollMs, "ms");
console.log("Waiting for OAuth / MCP / company activity…\n");

await tailOnce();

const timer = setInterval(() => {
  void tailOnce();
}, pollMs);

process.on("SIGINT", () => {
  clearInterval(timer);
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nStopped after ${mins} min (last id #${afterId})`);
  process.exit(0);
});
