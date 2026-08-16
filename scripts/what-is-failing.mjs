/**
 * Print current Airsup failures.
 * Usage: node --env-file=.env.local scripts/what-is-failing.mjs [hours]
 */
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_ANON_KEY;
const token = process.env.AIRSUP_DB_TOKEN;
const hours = Number(process.argv[2] || 48) || 48;

if (!url || !key || !token) {
  console.error("Need SUPABASE_URL, SUPABASE_ANON_KEY, AIRSUP_DB_TOKEN");
  process.exit(1);
}

const r = await fetch(`${url}/rest/v1/rpc/airsup_failures_list`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    apikey: key,
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({ p_token: token, p_hours: hours, p_limit: 50 }),
});

const raw = await r.text();
if (!r.ok) {
  console.error("RPC failed", r.status, raw.slice(0, 400));
  process.exit(1);
}

const report = JSON.parse(raw);
const messages = Array.isArray(report.messages) ? report.messages : [];
const events = Array.isArray(report.events) ? report.events : [];

console.log(`Airsup failures (last ${hours}h)`);
console.log(`since: ${report.since || "?"}`);
console.log(
  `counts: messages=${report.counts?.messages ?? messages.length} events=${report.counts?.events ?? events.length}`
);
console.log("");

if (!messages.length && !events.length) {
  console.log("Nothing failing in this window.");
  process.exit(0);
}

if (messages.length) {
  console.log("--- message issues ---");
  for (const m of messages) {
    const err = m.wake_error ? ` | ${String(m.wake_error).slice(0, 100)}` : "";
    console.log(
      `#${m.message_id} ${m.issue}: ${m.username} → ${m.peer_username} status=${m.status}${err}`
    );
  }
  console.log("");
}

if (events.length) {
  console.log("--- event issues ---");
  for (const e of events) {
    console.log(
      `${e.created_at} [${e.severity}/${e.kind}] ${e.username}→${e.peer_username}: ${e.summary}`
    );
  }
}
