import { orgoRelayMode } from "./orgo-actions";
import { relayViaChatGptDirect } from "./orgo-direct-relay";
import type { RelayStepReporter } from "./orgo-relay-progress";

export type OrgoRelayInput = {
  fromUsername: string;
  fromDisplayName?: string;
  message: string;
  conversationId: string;
  peerUsername?: string;
  continueThread?: boolean;
  onProgress?: RelayStepReporter;
};

export type OrgoRelayResult = {
  replyText: string;
  durationMs: number;
  steps?: number;
  costCents?: number;
  continueThread: boolean;
  relayMethod?: "direct" | "agent";
};

/** Send a message through the peer's ChatGPT browser and return the reply. */
export async function relayViaChatGptBrowser(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  if (orgoRelayMode() === "agent") {
    throw new Error(
      "ORGO_RELAY_MODE=agent is disabled. Use direct (Ctrl+Shift+O → type → wait → copy)."
    );
  }
  return relayViaChatGptDirect(computerId, input);
}
