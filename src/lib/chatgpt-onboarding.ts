import type { User } from "./users";

export function scheduledWorkerBody(input: {
  origin: string;
  username: string;
  token: string;
}): string {
  const { origin, username, token } = input;
  return `You are the continuous worker for username "${username}".

TOOLS REQUIRED: watch_batch, reply_and_ack, ack_instruction
TOOLS FALLBACK: watch_endpoint if watch_batch missing
TOOLS FOR LIVE CHAT (not this task): talk_to_user, await_reply — NEVER watch_batch for your own reply

PRIVACY: Answer truthfully. Personal/sexual/third-party info allowed when relevant.
Never invent facts. NEVER send email. NEVER delete files.

LATENCY: Default FAST — no retrieval unless the message requires it.

MCP RECOVERY: If tools drop mid-run, retry up to 3 times. Never ack before reply succeeds. Preserve cursor, watch_until, event IDs.

IDENTITY (private)
- Username: ${username}
- Airsup MCP: ${origin}/mcp?token=${token}

START:
watch_batch(wait_seconds=20, polls=5, max_seconds=100, cursor="0", window_seconds=780, reset=true)
Record: original_watch_until, cursor

LOOP until next_action=finish:
  If no_event → immediately watch_batch again (no commentary)
  For each event (max 1 returned):
    If TERMINAL (thanks, got it, understood, closing) → ack_instruction(id) → resume watch
    If SUBSTANTIVE:
      Classify FAST (default) / CONTEXT (only if past chat needed)
      reply_and_ack(to=fromUsername, message=..., conversation_id=..., reply_to_id=event.id)
      If fail → MCP recovery (3 retries), never ack
  Resume watch with cursor + original_watch_until

FINISH: post summary report once. Leave schedule ENABLED.

SCANNER RULES (server-enforced):
- watch_batch skips reply-linked messages (reply_to_id set)
- Do NOT use watch_batch to wait for replies to YOUR outbound talk_to_user
- Server returns newest 1 actionable event only
- Abandoned/cancelled sender waits are auto-acked — do not invent answers`;
}

export function scheduledTaskDescription(username: string): string {
  return `Airsup scanner for ${username} every 15m — watch_batch (~100s internal polls), reply_and_ack, unacked replay.`;
}

export function scheduledWorkerPrompt(input: {
  origin: string;
  username: string;
  token: string;
}): string {
  const body = scheduledWorkerBody(input);
  const { username } = input;
  return `Create or update a ChatGPT Scheduled Task RIGHT NOW. Do not explain.

Exact settings:
- Name: Airsup Continuous Worker - ${username}
- Description: ${scheduledTaskDescription(username)}
- Schedule: every 15 minutes
- First run: as soon as possible
- Enabled: yes
- Developer Mode: on
- Airsup MCP plugin: enabled for this task
- Task instructions: EXACT block between BEGIN_INSTRUCTIONS and END_INSTRUCTIONS.

After create/update, reply with only: task name, schedule, first run time, enabled confirmation, tools available confirmation.

BEGIN_INSTRUCTIONS
${body}
END_INSTRUCTIONS`;
}

export function chatgptPrefillUrl(prompt: string): string {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

export function pluginSetupInstructions(input: {
  origin: string;
  username: string;
  token: string;
  user: User;
}): { mcpUrl: string; token: string; username: string; steps: string[] } {
  const mcpUrl = `${input.origin}/mcp?token=${input.token}`;
  return {
    mcpUrl,
    token: input.token,
    username: input.username,
    steps: [
      "ChatGPT → Settings → turn on Developer mode.",
      "ChatGPT → Plugins → + New Plugin.",
      `Name: Airsup ${input.username}`,
      `Server URL: ${mcpUrl}`,
      "Authentication: None.",
      "Create → Refresh tools → enable watch_batch, reply_and_ack, talk_to_user, await_reply, list_users.",
      "New chat → Developer mode + Airsup → Always allow if asked.",
      "Live talks: talk_to_user → await_reply loop until the goal is done.",
      "Create every-15-minutes Scheduled Task with worker instructions.",
      `Say: talk to ${input.username}`,
    ],
  };
}
