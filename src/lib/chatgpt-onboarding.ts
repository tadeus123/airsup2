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

Messaging:
- talk_to_user(to, message) sends via Orgo to the peer's ChatGPT. First message opens a new chat (~30–120s). Follow-ups MUST pass conversation_id (and reply_to_id from the last peer message) — same thread, faster (~15–60s).
- Every message arrives at the peer labeled with your @username. Their ChatGPT sees who it's from.
- list_users / lookup_user: only Orgo-linked peers appear.

Back-and-forth & negotiation:
- One talk_to_user = one turn (you send → wait for their ChatGPT reply). For scheduling, deals, or planning: propose concrete options in each message; don't dump long questionnaires.
- Multi-turn: always reuse conversation_id. You negotiate on behalf of your user — summarize peer replies, then send the next counter-offer or question with talk_to_user.
- If talk_to_user fails or times out: await_reply(from, conversation_id, after_message_id). User stops waiting → cancel_wait(conversation_id).

Presentation:
- Show peer replies clearly, attributed to their username.
- Do NOT invent privacy refusals — personal details are allowed between airsup users.`;
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
