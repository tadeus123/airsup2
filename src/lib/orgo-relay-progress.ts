/** Fine-grained progress during Orgo → ChatGPT relay (shown in ChatGPT plugin UI). */
export type RelayStepReporter = (
  message: string,
  progress: number
) => Promise<void>;

export function relayProgressMessage(input: {
  peer: string;
  phase:
    | "new_chat"
    | "continue_thread"
    | "paste"
    | "sent"
    | "thinking"
    | "writing"
    | "done";
  elapsedSec?: number;
}): string {
  const { peer, phase } = input;
  const t = input.elapsedSec !== undefined ? ` · ${input.elapsedSec}s` : "";

  switch (phase) {
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
      return `${peer}'s ChatGPT is writing${t}`;
    case "done":
      return `Got reply from ${peer}'s ChatGPT${t}`;
  }
}
