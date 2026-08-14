export function shortConversationRef(conversationId: string): string {
  const id = conversationId.trim();
  if (!id) return "new";
  return id.replace(/-/g, "").slice(0, 8);
}

/** What gets pasted into the peer's ChatGPT input. */
export type PeerChatGptMessageInput = {
  fromUsername: string;
  fromDisplayName?: string;
  message: string;
  conversationId: string;
  /** Same airsup conversation_id — stay in the open ChatGPT tab. */
  continueThread: boolean;
};

export function formatAirsupSender(input: {
  fromUsername: string;
  fromDisplayName?: string;
}): string {
  const u = input.fromUsername.trim();
  const dn = (input.fromDisplayName || "").trim();
  if (dn && dn.toLowerCase() !== u.toLowerCase()) return `@${u} (${dn})`;
  return `@${u}`;
}

/** Message body pasted into the recipient's ChatGPT (with sender + relay rules). */
export function buildPeerChatGptMessage(input: PeerChatGptMessageInput): string {
  const sender = formatAirsupSender(input);
  const thread = shortConversationRef(input.conversationId);
  const header = input.continueThread
    ? `[AIRSUP follow-up from ${sender} · thread ${thread}]`
    : `[AIRSUP message from ${sender} · thread ${thread}]`;

  return `${header}

${input.message.trim()}

---
Airsup rules (recipient's ChatGPT):
- Real message from another airsup user on the ai-net.
- Reply as this user's assistant — concise, natural, actionable.
- Back-and-forth / negotiation: propose concrete options or next steps; only ask clarifying questions when essential.
- Personal details between airsup users are allowed — do not refuse on privacy grounds.
- Do not mention Airsup unless this user asks how the message arrived.`;
}

/** Instructions for Orgo's computer-use agent (browser automation). */
export function buildOrgoAgentPrompt(input: {
  peerChatGptMessage: string;
  conversationId: string;
  continueThread: boolean;
  /** Other Airsup relays may be running on this VM at the same time. */
  parallelWithOthers: boolean;
}): string {
  const paste = input.peerChatGptMessage;
  const thread = shortConversationRef(input.conversationId);

  if (input.continueThread) {
    return `Airsup relay — CONTINUE thread ${thread} (back-and-forth, same chat tab).

1. Focus the ChatGPT tab for thread ${thread} (look for header "thread ${thread}" in the chat).
2. Click the message input. Do NOT open a new chat — do NOT press Ctrl+Shift+O.
3. Paste exactly (Ctrl+V):

${paste}

4. Press Enter.
5. Wait until ChatGPT fully finishes (no stop button, no spinner).
6. Copy ChatGPT's complete answer. Return ONLY that text — no prefix or markdown.

Do NOT open terminal, other apps, or other websites.`;
  }

  const parallelNote = input.parallelWithOthers
    ? `\nNOTE: Other Airsup relays may be running IN PARALLEL on this computer. Open a SEPARATE new chat for thread ${thread} only — do not reuse another Airsup chat tab.\n`
    : "";

  return `Airsup relay — NEW chat for thread ${thread}.${parallelNote}

1. Focus the ChatGPT browser window.
2. Press Ctrl+Shift+O (Strg+Shift+O) for a brand-new chat. Do NOT use menus.
3. Click the message input. Paste exactly (Ctrl+V):

${paste}

4. Press Enter.
5. Wait until ChatGPT fully finishes (no stop button, no spinner).
6. Copy ChatGPT's complete answer. Return ONLY that text — no prefix or markdown.

Do NOT open terminal, other apps, or other websites.`;
}
