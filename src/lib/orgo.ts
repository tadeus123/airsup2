import {
  buildOrgoAgentPrompt,
  buildPeerChatGptMessage,
} from "./airsup-relay-prompt";
import { orgoRelayMode } from "./orgo-actions";
import { agentCopyReply, relayViaChatGptDirect } from "./orgo-direct-relay";
import type { RelayStepReporter } from "./orgo-relay-progress";
import { relayProgressMessage } from "./orgo-relay-progress";

const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

export type OrgoRelayInput = {
  fromUsername: string;
  fromDisplayName?: string;
  message: string;
  conversationId: string;
  peerUsername?: string;
  /** When true, Orgo continues the open ChatGPT tab instead of Ctrl+Shift+O new chat. */
  continueThread?: boolean;
  /** Hint that other relays may run in parallel on this Orgo VM (separate new chats). */
  parallelWithOthers?: boolean;
  onProgress?: RelayStepReporter;
};

export type OrgoRelayResult = {
  replyText: string;
  durationMs: number;
  steps?: number;
  costCents?: number;
  continueThread: boolean;
  /** How the relay ran: direct hotkeys vs full agent loop. */
  relayMethod?: "direct" | "agent";
};

function orgoApiKey(): string {
  const key = (process.env.ORGO_API_KEY || "").trim();
  if (!key) throw new Error("ORGO_API_KEY is not configured");
  return key;
}

/** Prompt Orgo's computer-use agent to relay a message through the open ChatGPT browser tab. */
export function buildChatGptRelayPrompt(input: OrgoRelayInput): string {
  const continueThread = Boolean(input.continueThread);
  const peerChatGptMessage = buildPeerChatGptMessage({
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    message: input.message,
    conversationId: input.conversationId,
    continueThread,
  });
  return buildOrgoAgentPrompt({
    peerChatGptMessage,
    conversationId: input.conversationId,
    continueThread,
    parallelWithOthers: Boolean(input.parallelWithOthers),
  });
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  orgo?: { steps?: number; cost_cents?: number };
  error?: { message?: string };
};

/** Full agent loop — only when ORGO_RELAY_MODE=agent. */
async function relayViaChatGptAgent(
  computerId: string,
  input: OrgoRelayInput,
  opts?: { alreadyPasted?: boolean }
): Promise<OrgoRelayResult> {
  const started = Date.now();
  const continueThread = Boolean(input.continueThread);
  const peer = input.peerUsername || input.fromUsername;
  const report = input.onProgress;
  const alreadyPasted = Boolean(opts?.alreadyPasted);

  const tickTimer = report
    ? setInterval(() => {
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        void report(
          relayProgressMessage({
            peer,
            phase: alreadyPasted ? "copy_agent" : "agent_loop",
            elapsedSec,
          }),
          50 + Math.min(35, elapsedSec)
        );
      }, 3000)
    : null;

  const model = (process.env.ORGO_MODEL || "claude-sonnet-5").trim();
  const timeoutMs = alreadyPasted
    ? Math.min(
        45_000,
        Math.max(15_000, Number(process.env.ORGO_COPY_TIMEOUT_MS || 30_000) || 30_000)
      )
    : Math.max(30_000, Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000);

  const peerChatGptMessage = buildPeerChatGptMessage({
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    message: input.message,
    conversationId: input.conversationId,
    continueThread,
  });
  const prompt = buildOrgoAgentPrompt({
    peerChatGptMessage,
    conversationId: input.conversationId,
    continueThread,
    parallelWithOthers: Boolean(input.parallelWithOthers),
    alreadyPasted,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ORGO_API_BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orgoApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        computer_id: computerId,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    let json: ChatCompletionResponse;
    try {
      json = JSON.parse(raw) as ChatCompletionResponse;
    } catch {
      throw new Error(`Orgo returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
    }

    if (!res.ok) {
      const msg = json.error?.message || raw.slice(0, 200);
      throw new Error(`Orgo API error ${res.status}: ${msg}`);
    }

    const replyText = (json.choices?.[0]?.message?.content || "").trim();
    if (!replyText) {
      throw new Error("Orgo returned empty reply from ChatGPT");
    }

    return {
      replyText,
      durationMs: Date.now() - started,
      steps: json.orgo?.steps,
      costCents: json.orgo?.cost_cents,
      continueThread,
      relayMethod: "agent",
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Orgo relay timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (tickTimer) clearInterval(tickTimer);
  }
}

function pasteWasSent(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "pasteSent" in err &&
      (err as { pasteSent?: boolean }).pasteSent
  );
}

/** Send a prompt to an Orgo computer; returns ChatGPT's reply text from the browser. */
export async function relayViaChatGptBrowser(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  const mode = orgoRelayMode();

  if (mode === "agent") {
    return relayViaChatGptAgent(computerId, input);
  }

  try {
    const result = await relayViaChatGptDirect(computerId, input);
    return { ...result, relayMethod: "direct" };
  } catch (e) {
    if (mode === "direct") throw e;

    if (pasteWasSent(e)) {
      console.warn("[orgo] direct copy failed after paste — copy-only agent retry");
      try {
        const replyText = await agentCopyReply(computerId);
        return {
          replyText,
          durationMs: 0,
          continueThread: Boolean(input.continueThread),
          relayMethod: "direct",
        };
      } catch {
        return relayViaChatGptAgent(computerId, input, { alreadyPasted: true });
      }
    }

    console.warn("[orgo] direct relay failed before paste — agent fallback:", e);
    return relayViaChatGptAgent(computerId, input);
  }
}
