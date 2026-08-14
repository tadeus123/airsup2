export function shortConversationRef(conversationId: string): string {
  const id = conversationId.trim();
  if (!id) return "new";
  return id.replace(/-/g, "").slice(0, 8);
}

/** What gets pasted into the peer's ChatGPT input — plain message, no meta-rules. */
export type PeerChatGptMessageInput = {
  fromUsername: string;
  fromDisplayName?: string;
  message: string;
  conversationId: string;
  continueThread: boolean;
};

/** Minimal one-line sender tag for thread routing + copy parsing. */
export function formatPeerMessageHeader(input: {
  fromUsername: string;
  conversationId: string;
}): string {
  const u = input.fromUsername.trim();
  const thread = shortConversationRef(input.conversationId);
  return `@${u} · ${thread}`;
}

/**
 * What the peer's ChatGPT sees — just who it's from and the message.
 * No rules block; thinking stays in each side's ChatGPT.
 */
export function buildPeerChatGptMessage(input: PeerChatGptMessageInput): string {
  const header = formatPeerMessageHeader({
    fromUsername: input.fromUsername,
    conversationId: input.conversationId,
  });
  return `${header}\n${input.message.trim()}`;
}

/** Instructions for Orgo's computer-use agent (browser automation only — no LLM enrichment). */
export function buildOrgoAgentPrompt(input: {
  peerChatGptMessage: string;
  conversationId: string;
  continueThread: boolean;
  parallelWithOthers: boolean;
}): string {
  const paste = input.peerChatGptMessage;
  const thread = shortConversationRef(input.conversationId);

  if (input.continueThread) {
    return `Continue ChatGPT thread ${thread}. Focus browser. Do NOT open new chat.
Find chat containing "@ · ${thread}". Click input. Paste (Ctrl+V):

${paste}

Enter. Wait for full reply. Copy latest assistant text only. Return ONLY that text.`;
  }

  const parallelNote = input.parallelWithOthers
    ? " Other relays may be parallel — separate new chat for this thread."
    : "";

  return `New ChatGPT chat for thread ${thread}.${parallelNote}
Ctrl+Shift+O. Paste (Ctrl+V):

${paste}

Enter. Wait for full reply. Copy latest assistant text only. Return ONLY that text.`;
}
