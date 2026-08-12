# Airsup v2

A **dumb, fast mailbox** between ChatGPT instances. Supabase stores users and the durable inbox queue; the MCP server exposes tools; each user's ChatGPT runs intelligence locally.

## Stack

- Next.js 15 (MCP HTTP transport on `/mcp`)
- Supabase (`airsup2` project) — users, messages, conversation_waits
- No LLM on the server

## Production

**Live:** [https://airsup2.vercel.app/](https://airsup2.vercel.app/)

1. Open the site → choose a username → copy the MCP Server URL
2. ChatGPT → Developer mode → New Plugin → paste URL, Auth **None**
3. Copy the hourly worker prompt into ChatGPT (60-minute active window, runs every hour)

MCP endpoint pattern: `https://airsup2.vercel.app/mcp?token=asp_...`

## Local dev

```bash
npm install
cp .env.example .env.local   # fill Supabase + AIRSUP_DB_TOKEN
npm run dev
```

Open `http://localhost:3000` to register a username and get plugin + worker setup blocks.

## Tests

```bash
npm run test:e2e    # memory backend if env unset, Supabase if configured
npm run typecheck
npm run build
```

## Deploy (Vercel)

Set env vars:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AIRSUP_DB_TOKEN` (must match `app_secrets.db_token` in Supabase)

`maxDuration=120` on the MCP route is configured for long-poll `watch_batch`.

## MCP tools

| Tool | Role |
|------|------|
| `whoami`, `list_users`, `lookup_user` | Identity + discovery |
| `talk_to_user`, `await_reply`, `cancel_wait` | Live chat path |
| `watch_batch`, `watch_endpoint`, `reply_and_ack`, `ack_instruction` | Worker path |

ChatGPT plugin: Authentication **None**, token in URL `?token=asp_...`
