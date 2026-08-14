/** Resolve whether to continue an existing ChatGPT thread vs open a new chat. */
export function resolveContinueThread(input: {
  conversationId?: string | null;
  replyToId?: number | null;
}): boolean {
  const conv = (input.conversationId || "").trim();
  const replyId = Number(input.replyToId);
  // Continue only when replying to a prior peer message (successful exchange).
  return Boolean(conv && Number.isFinite(replyId) && replyId > 0);
}
