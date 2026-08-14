/** Fine-grained progress during Orgo → ChatGPT relay (shown in ChatGPT plugin UI). */
export type RelayStepReporter = (
  message: string,
  progress: number
) => Promise<void>;

export function previewChars(text: string, max = 48): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function relayProgressMessage(input: {
  peer: string;
  phase:
    | "lease_wait"
    | "new_chat"
    | "continue_thread"
    | "paste"
    | "sent"
    | "thinking"
    | "writing"
    | "verify"
    | "copy_agent"
    | "agent_loop"
    | "done";
  elapsedSec?: number;
  charCount?: number;
  stable?: number;
  stableNeeded?: number;
  preview?: string;
}): string {
  const { peer, phase } = input;
  const t = input.elapsedSec !== undefined ? ` · ${input.elapsedSec}s` : "";

  switch (phase) {
    case "lease_wait":
      return `Waiting for Orgo slot on ${peer}'s computer…`;
    case "new_chat":
      return `Opening new ChatGPT chat on ${peer}'s Orgo (Ctrl+Shift+O)…`;
    case "continue_thread":
      return `Continuing ChatGPT thread with ${peer}…`;
    case "paste":
      return `Pasting your message into ${peer}'s ChatGPT…`;
    case "sent":
      return `Message sent — ${peer}'s ChatGPT is responding…`;
    case "thinking":
      return `${peer}'s ChatGPT is thinking${t}`;
    case "writing":
      if (input.preview) {
        return `${peer}'s ChatGPT: "${previewChars(input.preview)}"${t}`;
      }
      return `${peer}'s ChatGPT is writing${t}${input.charCount ? ` · ${input.charCount} chars` : ""}`;
    case "verify":
      return `Verifying ${peer}'s reply (${input.stable}/${input.stableNeeded})${t}`;
    case "copy_agent":
      return `Copying ${peer}'s reply from ChatGPT (fallback)…${t}`;
    case "agent_loop":
      return `Orgo agent driving ${peer}'s ChatGPT…${t}`;
    case "done":
      return `Got reply from ${peer}'s ChatGPT${t}`;
  }
}
