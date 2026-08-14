import {
  localSleep,
  orgoClickChatInput,
  orgoPressKey,
  orgoTypeText,
} from "./orgo-actions";
import type { RelayStepReporter } from "./orgo-relay-progress";
import { relayProgressMessage } from "./orgo-relay-progress";

/** Wake line pasted into peer ChatGPT — includes message id so check_inbox targets one thread. */
export function buildWakePrompt(fromUsername: string, messageId: number): string {
  const from = fromUsername.trim();
  const id = Number(messageId);
  if (!from || !Number.isFinite(id) || id <= 0) {
    throw new Error("buildWakePrompt requires fromUsername and messageId");
  }
  return `@airsup ${from} #${id}`;
}

/** Parse wake line from Orgo paste or user chat. Supports legacy "new message" too. */
export function parseWakePrompt(text: string): {
  fromUsername?: string;
  messageId?: number;
  legacy: boolean;
} {
  const s = text.trim();
  const tagged = /@airsup\s+([a-z0-9._-]+)\s+#(\d+)/i.exec(s);
  if (tagged) {
    return {
      fromUsername: tagged[1].toLowerCase(),
      messageId: Number(tagged[2]),
      legacy: false,
    };
  }
  const legacy = /@airsup\s+([a-z0-9._-]+)\s+new\s+message/i.exec(s);
  if (legacy) {
    return { fromUsername: legacy[1].toLowerCase(), legacy: true };
  }
  return { legacy: false };
}

/** Open new chat and paste wake trigger only (message already in Supabase). */
export async function wakePeerViaOrgo(
  computerId: string,
  input: {
    fromUsername: string;
    messageId: number;
    peerUsername?: string;
    onProgress?: RelayStepReporter;
  }
): Promise<{ durationMs: number }> {
  const started = Date.now();
  const peer = input.peerUsername || input.fromUsername;
  const report = input.onProgress;
  const wakeText = buildWakePrompt(input.fromUsername, input.messageId);

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
