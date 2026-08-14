import { buildPeerChatGptMessage } from "./airsup-relay-prompt";
import type { OrgoRelayInput, OrgoRelayResult } from "./orgo";
import {
  localSleep,
  orgoClickChatInput,
  orgoPressKey,
  orgoTypeText,
} from "./orgo-actions";
import { relayProgressMessage } from "./orgo-relay-progress";
import { pollUntilChatGptReply } from "./orgo-reply-poller";

/**
 * Simple relay:
 *   new message → Ctrl+Shift+O → type → Enter → wait → copy → return
 * Follow-ups skip the new-chat hotkey and type into the same thread.
 */
export async function relayViaChatGptDirect(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  const started = Date.now();
  const continueThread = Boolean(input.continueThread);
  const peer = input.peerUsername || "peer";
  const report = input.onProgress;
  const peerText = buildPeerChatGptMessage({
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    message: input.message,
    conversationId: input.conversationId,
    continueThread,
  });

  if (!continueThread) {
    await report?.(relayProgressMessage({ peer, phase: "new_chat" }), 32);
    await orgoClickChatInput(computerId);
    await orgoPressKey(computerId, "ctrl+shift+o");
    await localSleep(400);
  } else {
    await report?.(relayProgressMessage({ peer, phase: "continue_thread" }), 32);
  }

  await report?.(relayProgressMessage({ peer, phase: "paste" }), 40);
  await orgoClickChatInput(computerId);
  await orgoTypeText(computerId, peerText);
  await orgoPressKey(computerId, "Return");
  await report?.(relayProgressMessage({ peer, phase: "sent" }), 48);

  const polled = await pollUntilChatGptReply(computerId, input.message, {
    peer,
    onProgress: report,
  });

  await report?.(
    relayProgressMessage({
      peer,
      phase: "done",
      elapsedSec: Math.round((Date.now() - started) / 1000),
    }),
    92
  );

  return {
    replyText: polled.replyText,
    durationMs: Date.now() - started,
    continueThread,
    relayMethod: "direct",
  };
}
