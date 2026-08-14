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

/** Instructions for Orgo's computer-use agent — movement only, no reasoning. */
export function buildOrgoAgentPrompt(input: {
  peerChatGptMessage: string;
  conversationId: string;
  continueThread: boolean;
  parallelWithOthers: boolean;
  /** Direct hotkeys already pasted — agent must only wait + copy. */
  alreadyPasted?: boolean;
}): string {
  const paste = input.peerChatGptMessage;
  const thread = shortConversationRef(input.conversationId);

  if (input.alreadyPasted) {
    return `FAST. Max 3 steps. Message already sent in ChatGPT.
Wait until reply finished. Copy latest assistant text only. Return ONLY that text.
Do NOT open chats or paste again.`;
  }

  if (input.continueThread) {
    return `FAST. Max 5 steps. Thread ${thread}. Do NOT open new chat.
Find chat with "@ · ${thread}". Paste Ctrl+V, Enter. Wait. Copy latest assistant reply. Return ONLY that text.

${paste}`;
  }

  const chatStep = input.parallelWithOthers
    ? `Ctrl+Shift+O new chat for thread ${thread}.`
    : "Use current empty ChatGPT chat — do NOT open new chat unless input is not empty.";

  return `FAST. Max 6 steps. ${chatStep} Paste Ctrl+V, Enter. Wait. Copy latest assistant reply. Return ONLY that text.

${paste}`;
}
