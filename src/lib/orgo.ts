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
};

export async function relayViaChatGptBrowser(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  return relayViaChatGptDirect(computerId, input);
}
