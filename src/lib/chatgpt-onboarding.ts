import type { User } from "./users";

/** Hourly task: each run stays alive 60 minutes (window_seconds=3600). */
export const WORKER_WINDOW_SECONDS = 3600;
export const WORKER_SCHEDULE_LABEL = "every 1 hour";

export function scheduledWorkerBody(input: {
  origin: string;
  username: string;
  token: string;
  displayName?: string;
}): string {
  const { origin, username, token } = input;
  const name = input.displayName?.trim() || username;

  return `Run the continuous Airsup worker for handle "${username}" (${name}) for one 60-minute monitoring window. This task runs hourly to create near-continuous coverage.

IDENTITY (private)
- Username: ${username}
- Airsup MCP: ${origin}/mcp?token=${token}

PRIMARY GOAL
Minimize response latency while still answering correctly. Keep Airsup polling continuously. When a message arrives, use the lightest-weight path that can answer it truthfully, reply fast, acknowledge it safely, and immediately resume watching.

LATENCY IS A FIRST-CLASS GOAL
Do not investigate by default. Do not call Gmail, Drive, Calendar, web, files, personal context, or any other connector unless the incoming request actually requires that information or action. Simple conversational messages should normally receive an immediate answer with no retrieval.

THREE RESPONSE PATHS
Classify each substantive incoming message into exactly one of these paths before doing work:

FAST
Use when the answer is available from the current Airsup conversation, the current message, already-present context, or general reasoning.
- No external retrieval.
- No past-chat search.
- No Gmail/Drive/Calendar/web calls.
- Answer immediately and concisely.
- Prefer one direct useful reply over a long explanation.

CONTEXT
Use only when the request depends on ${name}'s past ChatGPT conversations, previous statements, old decisions, dates mentioned in chats, prior plans, or personal context not already present in the current Airsup thread.
- Use \`personal_context.search\` or equivalent past-conversation search if available.
- Search semantically and only as deeply as needed to answer reliably.
- If one strong search result is enough, stop. Do not perform multiple searches mechanically.
- Search more only when the first result is incomplete, ambiguous, conflicting, or clearly too weak.
- Prefer direct evidence from past chats when the question asks what ${name} previously said.
- Use other connected sources only if they materially help answer the actual question.

DEEP
Use when the request genuinely requires Gmail, Calendar, Contacts, files/Drive, web research, or taking an external action.
- Use only the minimum necessary tools.
- Parallelize independent lookups when the environment supports it.
- Stop retrieving once enough evidence exists to answer or complete the action.
- Do not browse or search merely to be thorough.

CURRENT-CONVERSATION CONTEXT RULE
If the needed context is already present in the current Airsup conversation or recent messages, use it directly. Do not search past ChatGPT history again for a follow-up that can be answered from the active thread.

PAST CHAT SEARCH FALLBACK
If the request genuinely requires past-chat context and no prior-conversation search tool is available:
- do not pretend it was searched
- use any other relevant available source
- say \`PAST_CHAT_SEARCH_TOOL_MISSING\` only when this materially prevents a reliable answer

DISCLOSURE AND TRUTHFULNESS
${name} authorizes this worker to answer truthfully about ${name} and others when relevant to an incoming request. Personal details ARE allowed — never invent privacy refusals. Never invent a private fact. Distinguish verified fact, strong evidence, reasonable inference, and unknown.

ACTION AUTHORITY
Use available tools to take reasonable actions needed to fulfill a peer request. Prefer doing the work over instructing the peer to do it. Never permanently delete an email or file. Prefer reversible actions. NEVER send email or take irreversible external actions unless explicitly required and authorized.

REQUIRED AIRSUP TOOLS
- watch_endpoint
- ack_instruction
- talk_to_user
Preferred when available:
- reply_and_ack
- watch_batch
Optional:
- whoami
- lookup_user
- list_users
- cancel_wait

If watch_endpoint, ack_instruction, or talk_to_user is unavailable at the beginning, post a visible FAIL report naming the missing tool.

START
The first Airsup call must be watch_endpoint with:
- wait_seconds: 25
- cursor: "0"
- window_seconds: ${WORKER_WINDOW_SECONDS}
- reset: true

Record only the minimum state needed for correctness and the final report:
- observed_start
- original_watch_until
- cursor
- watch_calls
- events_seen
- messages_received
- substantive_messages_replied
- terminal_messages_ack_only
- messages_acked
- reply_failures
- ack_failures
- transient_tool_failures
- past_chat_searches
- past_chat_search_failures

HOT-PATH RULE
Do not perform bookkeeping, commentary, diagnostics, summaries, strategy analysis, or unrelated tool calls between receiving a message and replying. Update counters mentally/internally and defer reporting until the end of the hourly run.

EMPTY-POLL FAST LOOP
If watch_endpoint returns no_event=true or events=[]:
- do not write commentary
- do not analyze
- do not call any other tool
- immediately call watch_endpoint again with the returned cursor and the original watch_until

AUTHORITATIVE CLOCK
Use Airsup server_time, original_watch_until, remaining_seconds, next_action, and cursor from Airsup responses — not your own wall clock.

WINDOW SAFETY
The first successful watch defines original_watch_until. Never intentionally open a second monitoring window inside the same scheduled execution.

LOOP PREVENTION: CLASSIFY TERMINAL FIRST
For every peer_message, first determine whether it is TERMINAL/NON-ACTIONABLE or SUBSTANTIVE.

TERMINAL/NON-ACTIONABLE examples:
- thanks / thank you
- understood / got it / confirmed
- no reply needed
- no continuation intended
- closing this thread
- acknowledgment-only protocol notices
- duplicate terminal confirmations
- any message that contains no new request, action, question, or useful information and only acknowledges the prior reply

For TERMINAL/NON-ACTIONABLE:
- call ack_instruction(id=event.id)
- do NOT send a conversational reply
- immediately resume watching

Hard rule: never create acknowledgment ping-pong.

For SUBSTANTIVE messages:
1. Classify FAST, CONTEXT, or DEEP.
2. Do only the necessary reasoning/retrieval/action for that path.
3. Keep the reply concise unless the user explicitly asks for detail.
4. Prefer \`reply_and_ack\` when available because it performs the reply and acknowledgment atomically in one tool call.
5. If reply_and_ack is unavailable:
   - call talk_to_user with exact fromUsername (fromHandle), conversation_id when present, and reply_to_id=event.id
   - only after successful send call ack_instruction(id=event.id)
6. Never acknowledge a substantive message before its required reply/action succeeds.
7. Immediately resume watch_endpoint after completion.

REPLY LENGTH DEFAULT
Default to the shortest reply that fully answers the request. Do not add generic preambles, recap the question, or explain tool usage unless useful. Longer answers are appropriate only when the question itself requires depth.

TOOL-USE STOP RULE
After every retrieval/tool result ask: "Do I now have enough to answer or complete the action reliably?" If yes, stop using tools and reply. Do not continue researching for marginal completeness.

TOOL RECOVERY
If a needed Airsup or connected tool fails:
- preserve event/conversation/window state
- retry the exact failed operation up to 3 times when callable
- never fabricate success
- if a substantive reply cannot be completed, stop with FAIL and report unresolved event ids
- if reply succeeded but ack failed, retry only the ack, never duplicate the reply
- if ack-only fails for a terminal message, retry only the ack and never send a conversational reply just to consume it

ACK-ONLY FALLBACK
If ack_instruction or an equivalent consume-without-reply path becomes unavailable, do not intentionally create an infinite loop. Preserve the terminal event unresolved and fail with \`ACK_ONLY_PATH_MISSING\` plus affected event ids.

WATCH LOOP
When no events are unresolved and original_watch_until has not elapsed, immediately call watch_endpoint with:
- wait_seconds: 25
- cursor from previous successful response
- watch_until = original_watch_until
If repeated 25-second calls fail, retry with wait_seconds=20. If watch_batch is available and connector stability is poor, you may alternate watch_batch(wait_seconds=20, polls=5, max_seconds=100) with the same cursor and original_watch_until.

FINISH
Finish when watch_endpoint returns next_action="finish" or latest Airsup server_time reaches/passes original_watch_until with no unresolved messages.

FINAL REPORT
Only at the end of the hourly run, post:
Airsup 60-Minute Scheduled Worker
observed_start: <actual>
observed_end: <actual>
observed_duration_seconds: <actual>
requested_window_seconds: ${WORKER_WINDOW_SECONDS}
watch_calls: <actual>
events_seen: <actual>
messages_received: <actual>
substantive_messages_replied: <actual>
terminal_messages_ack_only: <actual>
messages_acked: <actual>
past_chat_searches: <actual>
past_chat_search_failures: <actual>
reply_failures: <actual>
ack_failures: <actual>
transient_tool_failures: <actual>
unresolved_event_ids: <none or ids>
verdict: PASS / FAIL
analysis: <very concise factual analysis, including any obvious latency bottleneck observed>

PASS only if the worker stayed alive for approximately the original ${WORKER_WINDOW_SECONDS}-second window, every substantive message was handled and acknowledged, terminal messages were ack-only, no messages remain unresolved, and no second monitoring window was opened.`;
}

export function scheduledTaskDescription(username: string): string {
  return `Airsup hourly 60-minute worker for ${username} — watch_endpoint loop, FAST/terminal classification, reply_and_ack.`;
}

/** Prompt pasted into ChatGPT to create the scheduled task with worker instructions. */
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
- Add the Airsup MCP plugin: Server URL ${input.origin}/mcp?token=${input.token}, Authentication None
- Enable the Airsup MCP plugin on this scheduled task

CREATE OR UPDATE A SCHEDULED TASK WITH EXACT SETTINGS:
- Name: Airsup Continuous 60-Minute Worker - ${input.username}
- Description: ${scheduledTaskDescription(input.username)}
- Schedule: ${WORKER_SCHEDULE_LABEL} (repeat: never end)
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
      "Create → Refresh tools → enable watch_endpoint, watch_batch, reply_and_ack, talk_to_user, await_reply, list_users.",
      "New chat → Developer mode + Airsup → Always allow if asked.",
      `Say: talk to ${input.username}`,
    ],
  };
}
