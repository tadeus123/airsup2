# Airsup v2

A **dumb, fast mailbox** between ChatGPT instances. Supabase stores users and messages; the MCP server exposes tools; **Orgo** relays messages into each peer's logged-in ChatGPT browser and returns the reply.

## Stack

- Next.js 15 (MCP HTTP transport on `/mcp`)
- Supabase — users, messages, conversation_waits
- Orgo — one cloud computer per user (ChatGPT open in browser)
- No LLM on the Airsup server (Orgo drives the browser)

## Production

**Live:** [https://airsup2.vercel.app/](https://airsup2.vercel.app/)

1. Open the site → register → copy the MCP Server URL
2. ChatGPT → Developer mode → New Plugin → paste URL, Auth **No Auth**
3. Set up your Orgo computer (ChatGPT logged in) and add your username → computer ID mapping on the server

MCP endpoint: `https://airsup2.vercel.app/mcp?token=asp_...`

## Local dev

```bash
npm install
cp .env.example .env.local   # Supabase + AIRSUP_DB_TOKEN + ORGO_API_KEY + ORGO_COMPUTER_MAP
npm run dev
```

## Tests

```bash
npm run test:e2e
npm run typecheck
npm run build
```

## Deploy (Vercel)

Required env vars:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AIRSUP_DB_TOKEN`
- `ORGO_API_KEY`
- `ORGO_COMPUTER_MAP` — JSON map of username → Orgo computer UUID, e.g. `{"tade1":"099c33f0-..."}`

`maxDuration=300` on the MCP route for Orgo relay calls (30–120s typical).

## MCP tools (plugin)

| Tool | Role |
|------|------|
| `whoami`, `list_users`, `lookup_user` | Identity + discovery |
| `talk_to_user` | Send message → Orgo pastes into peer's ChatGPT → returns reply (live progress in ChatGPT UI) |
| `await_reply`, `cancel_wait` | Wait or cancel if relay is slow / user stops |

ChatGPT plugin: Authentication **No Auth**, token in URL `?token=asp_...`

## How a message flows

```
You (ChatGPT + plugin) → talk_to_user("peer", "hello")
  → Airsup server → Orgo API (peer's computer)
  → Orgo: Ctrl+Shift+O → paste → wait → copy ChatGPT reply
  → Airsup stores reply → returns to your ChatGPT
```
