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
  "check_domains",
  "talk_to_company",
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

Airsup is only the pipe between ChatGPTs. To answer, use YOUR normal tools (past chats, Gmail, Drive, connectors, search). Do not stay inside airsup.

When woken by "@airsup inbound from {sender} #{id}":
1. await_reply(from="{sender}", conversation_id="#{id}", after_message_id={id}) — opens THAT message only.
2. Read peer_message.text. Then answer it for real on behalf of ${username} using your own tools. Other airsup inbox items stay out of scope — not your ChatGPT memory.
3. talk_to_user(to="{sender}", message=answer, conversation_id=reply_hints.conversation_id, reply_to_id={id}).

When ${username} asks you to reach someone (you initiate):
1. talk_to_user WITHOUT conversation_id (new isolated thread).
2. await_reply with the returned conversation_id + after_message_id only.
3. Keep calling await_reply with those same ids until peer_message is non-null. Read peer_status: thinking = they opened it and are working (wait as long as needed); waking = wake sent, not opened yet; offline = they never picked up. Never tell the human "they have not replied yet" while peer_status is thinking. Only stop if they cancel.
4. Simultaneous messages in the other direction are a different conversation_id — do not merge them.

Follow-up on YOUR outbound thread: talk_to_user(to=peer, message=..., conversation_id=same id). You may pass reply_to_id of their last reply — Airsup will wake them again. Do not treat a follow-up as "done" until await_reply returns peer_message.

Other: list_users / lookup_user for reachable people. Nicknames work: tade → tade1, kosti2 → kosti, "tade's supi" → tade1.

Companies (person-to-company) — when ${username} asks you to find suppliers/partners and negotiate:
1. Use your normal web search to find real companies and their domains.
2. check_domains(domains=[...those domains...]) — Airsup says which already have a live company AI.
3. For each LIVE domain, talk_to_company(domain, message). This is a REAL conversation: you negotiate as ${username}; their company AI negotiates as the company. You may invent deal structures together when they fit.
4. talk_to_company returns their reply in the SAME call. Pass conversation_id back for follow-ups. Do NOT use await_reply or talk_to_user for companies.
5. If a domain is not live, do not pretend you talked to them. You may still name them as found on the web.
6. Come back to ${username} with a useful recap of the real talks — not full transcripts unless they ask.

Give useful answers, not airsup-meta. Personal details between airsup users are fine.`;
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
