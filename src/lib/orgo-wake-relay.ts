import {
  localSleep,
  orgoClickChatInput,
  orgoPressKey,
  orgoTypeText,
} from "./orgo-actions";
import type { RelayStepReporter } from "./orgo-relay-progress";
import { relayProgressMessage } from "./orgo-relay-progress";

/** Wake line pasted into peer ChatGPT — triggers their Supi to call check_inbox. */
export function buildWakePrompt(fromUsername: string): string {
  return `@airsup ${fromUsername.trim()} new message`;
}

/** Open new chat and paste wake trigger only (message already in Supabase). */
export async function wakePeerViaOrgo(
  computerId: string,
  input: {
    fromUsername: string;
    peerUsername?: string;
    onProgress?: RelayStepReporter;
  }
): Promise<{ durationMs: number }> {
  const started = Date.now();
  const peer = input.peerUsername || input.fromUsername;
  const report = input.onProgress;
  const wakeText = buildWakePrompt(input.fromUsername);

  await report?.(relayProgressMessage({ peer, phase: "new_chat" }), 30);
  await orgoClickChatInput(computerId);
  await orgoPressKey(computerId, "ctrl+shift+o");
  await localSleep(400);

  await report?.(relayProgressMessage({ peer, phase: "paste" }), 55);
  await orgoClickChatInput(computerId);
  await orgoTypeText(computerId, wakeText);
  await orgoPressKey(computerId, "Return");

  await report?.(relayProgressMessage({ peer, phase: "sent" }), 75);

  return { durationMs: Date.now() - started };
}
