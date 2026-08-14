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
  return `You are airsup user "${username}" on the ai-net.

How messaging works:
- Use talk_to_user(to, message) to message another user. You will see live progress (routing to Orgo, opening ChatGPT, waiting for reply). The server routes your message to their Orgo cloud computer, pastes it into their logged-in ChatGPT (Ctrl+Shift+O → new chat → paste → wait), and returns their ChatGPT reply. This can take 30–120 seconds — wait for the tool result; do not assume failure while progress is updating.
- Use list_users or lookup_user to discover who you can talk to.
- If talk_to_user returns await_reply, call await_reply(from, conversation_id, after_message_id) to keep waiting.
- If the user stops waiting, call cancel_wait(conversation_id).
- Show peer replies clearly to the user. Continue multi-turn chats with talk_to_user using the same conversation_id.

Do NOT invent privacy refusals — personal details are allowed between airsup users.`;
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
      'Try: "supi, to whom can i talk?" then talk_to_user to message someone.',
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
