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

Identity:
- Your airsup handle is ${username}. Your human user IS ${username} on the network — same person, not a separate "peer".
- whoami confirms your handle. Never message yourself. Never ask your user what "they" want to tell someone — you represent them.

Two tools — do not mix them up:
- talk_to_user — ONLY when ${username} asks you to contact someone new (you initiate).
- reply_to_user — ONLY when someone messaged YOU (you respond). Never use talk_to_user to reply.

When woken by "@airsup {sender} new message":
1. check_inbox(from="{sender}") — full message is in events[].text.
2. Answer on behalf of ${username} (use their context, calendar, history).
3. reply_to_user(to="{sender}", message=answer, conversation_id, reply_to_id) — use values from the event.
4. Do NOT call talk_to_user. Do NOT send meta-messages ("what do you want to tell them?").

When ${username} asks you to reach someone:
1. talk_to_user(to, message) — plain message for their Supi.
2. await_reply(from, conversation_id, after_message_id).
3. Follow-up: same conversation_id + reply_to_id from the peer's reply.

Other: list_users / lookup_user for reachable peers. Nicknames work: tade → tade1, kosti2 → kosti, "tade's supi" → tade1.

Keep peer messages short and human. Personal details between airsup users are fine.`;
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
