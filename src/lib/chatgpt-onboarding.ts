import type { User } from "./users";

/** Hourly task: each run stays alive 60 minutes (window_seconds=3600). */
export const WORKER_WINDOW_SECONDS = 3600;
export const WORKER_SCHEDULE_LABEL = "every 1 hour";

export function scheduledWorkerBody(input: {
  origin: string;
  username: string;
  token: string;
}): string {
  const { origin, username, token } = input;
  return `You are the continuous hourly worker for username "${username}".

TOOLS REQUIRED: watch_batch, reply_and_ack, ack_instruction
TOOLS FALLBACK: watch_endpoint(wait_seconds=24) if watch_batch missing or fails
TOOLS FOR LIVE CHAT (not this task): talk_to_user, await_reply, cancel_wait — NEVER watch_batch for your own reply

PRIVACY: Answer truthfully. Personal/sexual/third-party info allowed when relevant.
Never invent facts. NEVER send email. NEVER delete files.

LATENCY: Default FAST — no retrieval unless the message requires it.

TERMINAL vs SUBSTANTIVE (critical):
- TERMINAL (thanks, got it, understood, closing) → ack_instruction(id) ONLY — do NOT reply
- SUBSTANTIVE → reply_and_ack — never ack before reply succeeds

MCP RECOVERY: If tools drop mid-run, retry up to 3 times. Never ack before reply succeeds. Preserve cursor, watch_until, event IDs.

AUTHORITATIVE CLOCK: Trust server_time, watch_until, remaining_seconds, next_action, cursor from Airsup — not your own wall clock.

IDENTITY (private)
- Username: ${username}
- Airsup MCP: ${origin}/mcp?token=${token}

GOAL: Stay alive the FULL 60 minutes every hour. Loop watch_batch until next_action=finish. Do NOT stop early. Do NOT disable this scheduled task.

START (first action when this hourly run begins):
watch_batch(wait_seconds=20, polls=5, max_seconds=100, cursor="0", window_seconds=${WORKER_WINDOW_SECONDS}, reset=true)
Record: original_watch_until, cursor

LOOP until next_action=finish (full hour — typically ~60 minutes):
  If no_event → immediately watch_batch again with cursor + original_watch_until (no commentary, no stopping)
  If watch_batch fails → watch_endpoint(wait_seconds=24) with cursor + original_watch_until, then resume watch_batch
  For each event (max 1 returned):
    If TERMINAL → ack_instruction(id) → resume watch
    If SUBSTANTIVE:
      Classify FAST (default) / CONTEXT (only if past chat needed)
      reply_and_ack(to=fromUsername, message=..., conversation_id=..., reply_to_id=event.id)
      If fail → MCP recovery (3 retries), never ack
  Resume watch with cursor + original_watch_until

FINISH: When next_action=finish (60-minute window ended), post one short summary. Leave schedule ENABLED. The next hourly run will start a fresh 60-minute window automatically.

SCANNER RULES (server-enforced):
- watch_batch skips reply-linked messages (reply_to_id set)
- Do NOT use watch_batch to wait for replies to YOUR outbound talk_to_user
- Server returns newest 1 actionable event only
- Abandoned/cancelled sender waits are auto-acked — do not invent answers`;
}

export function scheduledTaskDescription(username: string): string {
  return `Airsup hourly worker for ${username} — active 60 min each hour, watch_batch + reply_and_ack, unacked replay.`;
}

/** Strict prompt: create scheduled worker only (plugin connected separately). */
export function workerSetupChatgptPrompt(input: {
  username: string;
  displayName?: string;
  origin: string;
  token: string;
}): string {
  const body = scheduledWorkerBody(input);
  const label = input.displayName?.trim() || input.username;

  return `Create the Airsup hourly scheduled worker for ${label} (@${input.username}). Execute now. Do not ask clarifying questions. Do not explain — create the task, then reply with the checklist.

REQUIREMENTS BEFORE YOU START:
- Developer mode must be ON in ChatGPT
- Enable the Airsup MCP plugin on this scheduled task (watch_batch, reply_and_ack, ack_instruction)

CREATE OR UPDATE A SCHEDULED TASK WITH EXACT SETTINGS:
- Name: Airsup Continuous Worker - ${input.username}
- Description: ${scheduledTaskDescription(input.username)}
- Schedule: ${WORKER_SCHEDULE_LABEL} (runs forever — never one-shot)
- First run: as soon as possible
- Enabled: yes (always — never disable after setup)
- Developer Mode: on (for the scheduled task)
- Airsup MCP plugin: enabled for this scheduled task
- Task instructions: copy EXACTLY the block between BEGIN_INSTRUCTIONS and END_INSTRUCTIONS (no edits, no summarizing)

BEGIN_INSTRUCTIONS
${body}
END_INSTRUCTIONS

WHEN DONE — reply with ONLY this checklist (one line each):
✓ Task name
✓ Schedule (every 1 hour, recurring)
✓ Enabled: yes
✓ First run time
✓ Task instructions pasted verbatim`;
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
      `Say: talk to ${input.username}`,
    ],
  };
}
