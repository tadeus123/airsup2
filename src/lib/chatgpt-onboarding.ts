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
      "Leave ChatGPT open in the browser — Airsup pastes messages into it automatically.",
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
- The \`message\` is a plain natural message their ChatGPT reads — like a text from @${username}. No instructions to their AI, no meta-rules, no "Airsup rules".

Achieving goals:
1. Understand what the user wants done.
2. If someone else must answer or act, talk_to_user with a clear plain message.
3. Show their reply; decide if the goal is met or you need another turn (same conversation_id + reply_to_id).
4. Summarize the outcome for the user.

talk_to_user mechanics:
- First contact: no conversation_id / reply_to_id.
- Follow-up: pass conversation_id and reply_to_id from the last peer reply.
- list_users / lookup_user — who is reachable (Orgo-linked).
- Orgo relay failed → retry talk_to_user. await_reply only if a reply may already be in your inbox.

Keep messages to peers short and human. Personal details between airsup users are fine — do not invent privacy refusals.`;
}

export function gatewaySetupSteps(input: {
  username: string;
  origin: string;
  token: string;
}): { mcpUrl: string; steps: string[] } {
  const mcpUrl = `${input.origin}/mcp?token=${input.token}`;
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
