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

/** Minimal one-line sender tag (internal / logging only). */
export function formatPeerMessageHeader(input: {
  fromUsername: string;
  conversationId: string;
}): string {
  const u = input.fromUsername.trim();
  const thread = shortConversationRef(input.conversationId);
  return `@${u} · ${thread}`;
}

/**
 * What the peer's ChatGPT sees.
 * First message: clear "From @user" prefix so plain ChatGPT understands.
 * Follow-up: just the message (same thread already open).
 */
export function buildPeerChatGptMessage(input: PeerChatGptMessageInput): string {
  const body = input.message.trim();
  if (input.continueThread) return body;
  const from = input.fromUsername.trim();
  return `From @${from}:\n\n${body}`;
}
