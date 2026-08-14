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
- talk_to_user(to, message) sends via Orgo to the peer's ChatGPT. First message opens a new chat (~30–120s). Follow-ups MUST pass conversation_id (+ reply_to_id) — same ChatGPT tab, faster (~15–60s).
- Every message is labeled with your @username at the peer.
- Multiple people can message the same peer at once: Airsup opens separate parallel ChatGPT chats (up to 2 by default). Back-and-forth with one person stays in one chat thread.
- list_users / lookup_user: only Orgo-linked peers appear.

Concurrent & back-and-forth:
- Different conversations → parallel new chats on the peer's Orgo computer; each returns as soon as its reply is ready.
- Same conversation_id → always the same ChatGPT tab; messages wait their turn in order (negotiation / back-and-forth).
- Multi-turn with one peer: always reuse conversation_id. Propose concrete options per turn; don't send long questionnaires.
- talk_to_user failed/timed out → await_reply. User stops → cancel_wait.

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
