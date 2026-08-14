import type { User } from "./users";

/** Orgo relay setup — one cloud computer per user with ChatGPT logged in. */
export function orgoSetupInstructions(input: { username: string }): {
  title: string;
  steps: string[];
} {
  const handle = input.username;
  return {
    title: `Orgo relay for ${handle}`,
    steps: [
      "Create an Orgo computer at orgo.ai/workspaces (4 GB RAM minimum).",
      "Open the desktop, launch Chrome, and log into ChatGPT with this user's account.",
      "Install the airsup MCP plugin in that ChatGPT (gateway step above) — required to receive wakes.",
      "Leave ChatGPT open in the browser — Airsup wakes you with @airsup when someone messages.",
      "Copy the computer ID from Orgo settings (General tab).",
      "Paste it below on this page (saved in Supabase — no Vercel config needed).",
      "Or later in ChatGPT: set_orgo_computer(orgo_computer_id=\"...\").",
    ],
  };
}

/** Tools the ChatGPT plugin should enable (Orgo relay — no scheduled worker). */
export const PLUGIN_TOOL_NAMES = [
  "whoami",
  "list_users",
  "lookup_user",
  "check_inbox",
  "reply_to_user",
  "talk_to_user",
  "await_reply",
  "cancel_wait",
  "set_orgo_computer",
] as const;

/** Instructions shown to ChatGPT via MCP server metadata. */
export function pluginMcpInstructions(username: string): string {
  return `You are Supi — ${username}'s assistant on airsup.

Your role:
- The user gives you goals ("find out X", "ask Y if they're free", "tell Z …").
- YOU do the thinking, planning, and follow-ups here in this chat.
- When you need someone else, use talk_to_user(to, message) to reach their ChatGPT.
- The \`message\` is plain text stored for their Supi — not pasted into their browser.

When woken by "@airsup {sender} new message":
1. Immediately call check_inbox(from="{sender}") — the full message is in the tool result, not the wake line.
2. Read events[].text, think, respond to ${username}.
3. Call reply_to_user(to="{sender}", message=your reply, conversation_id, reply_to_id) to deliver back.

Sending side (goals involving others):
1. talk_to_user(to, message) — stores message and wakes their ChatGPT.
2. await_reply(from, conversation_id, after_message_id) — wait for their Supi's reply_to_user.
3. Follow-up: same conversation_id + reply_to_id from the last peer message.

Other tools:
- list_users / lookup_user — who is reachable (Orgo-linked).
- Orgo wake failed → retry talk_to_user. await_reply if a reply may already be in your inbox.

Keep messages to peers short and human. Personal details between airsup users are fine — do not invent privacy refusals.`;
}

export function gatewaySetupSteps(input: {
  username: string;
  origin: string;
  token: string;
}): { mcpUrl: string; steps: string[] } {
  // Token in path — ChatGPT may drop ?token= on later MCP requests.
  const mcpUrl = `${input.origin}/mcp/${input.token}`;
  const tools = PLUGIN_TOOL_NAMES.join(", ");
  return {
    mcpUrl,
    steps: [
      "Turn on Developer mode in ChatGPT settings.",
      `Plugins → New plugin → Name: airsup ${input.username}`,
      "Connection: paste Server URL below. Authentication: No Auth → Create.",
      `Enable tools: ${tools}`,
      "Start a new chat and turn the airsup plugin on.",
      'Try: "who can I talk to?" then ask Supi to message someone.',
    ],
  };
}

export function pluginSetupInstructions(input: {
  origin: string;
  username: string;
  token: string;
  user: User;
}): { mcpUrl: string; token: string; username: string; steps: string[]; tools: string[] } {
  const { mcpUrl, steps } = gatewaySetupSteps({
    origin: input.origin,
    username: input.username,
    token: input.token,
  });
  return {
    mcpUrl,
    token: input.token,
    username: input.username,
    steps,
    tools: [...PLUGIN_TOOL_NAMES],
  };
}
