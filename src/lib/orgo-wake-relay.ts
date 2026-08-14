import {
  localSleep,
  orgoClickChatInput,
  orgoPasteText,
  orgoPressKey,
} from "./orgo-actions";
import type { RelayStepReporter } from "./orgo-relay-progress";
import { relayProgressMessage } from "./orgo-relay-progress";

/** Wake line pasted into peer ChatGPT — id is inside `from` so cached ChatGPT schemas still work. */
export function buildWakePrompt(fromUsername: string, messageId: number): string {
  const from = fromUsername.trim();
  const id = Number(messageId);
  if (!from || !Number.isFinite(id) || id <= 0) {
    throw new Error("buildWakePrompt requires fromUsername and messageId");
  }
  return `@airsup inbound from ${from} #${id}. Call await_reply(from="${from}", conversation_id="#${id}", after_message_id=${id}). Read peer_message.text, answer, then talk_to_user(to="${from}", message=your answer, conversation_id=reply_hints.conversation_id, reply_to_id=${id}). Do not ask the human.`;
}

/** Parse "tade1#184" / "tade1 #184" plus an optional separate message_id. */
export function parseInboxRef(
  fromRaw: string,
  messageIdRaw?: unknown
): { from: string; messageId: number } | { error: string } {
  const s = (fromRaw || "").trim();
  const hashed =
    /^@?([a-z0-9._-]+)\s*[#:/]\s*(\d+)\s*$/i.exec(s) ||
    /^@?([a-z0-9._-]+)\s+#(\d+)\s*$/i.exec(s);
  const from = hashed ? hashed[1] : s.replace(/#\d+\s*$/, "").trim();
  const fromId = hashed ? Number(hashed[2]) : NaN;
  const extra = Number(messageIdRaw);
  const messageId =
    Number.isFinite(extra) && extra > 0
      ? extra
      : Number.isFinite(fromId) && fromId > 0
        ? fromId
        : NaN;
  if (!from) return { error: "from is required" };
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return {
      error:
        'Pass the wake id inside from, like from="tade1#184". Airsup will not list other inbox messages.',
    };
  }
  return { from, messageId };
}

/** Parse wake line from Orgo paste or user chat. Supports legacy "new message" too. */
export function parseWakePrompt(text: string): {
  fromUsername?: string;
  messageId?: number;
  legacy: boolean;
} {
  const s = text.trim();
  const inbound = /@airsup\s+inbound\s+from\s+([a-z0-9._-]+)\s+#(\d+)/i.exec(s);
  if (inbound) {
    return {
      fromUsername: inbound[1].toLowerCase(),
      messageId: Number(inbound[2]),
      legacy: false,
    };
  }
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
  await orgoPasteText(computerId, wakeText);
  await orgoPressKey(computerId, "Return");

  await report?.(relayProgressMessage({ peer, phase: "sent" }), 75);

  return { durationMs: Date.now() - started };
}
