import {
  buildOrgoAgentPrompt,
  buildPeerChatGptMessage,
} from "./airsup-relay-prompt";

const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

export type OrgoRelayInput = {
  fromUsername: string;
  fromDisplayName?: string;
  message: string;
  /** When true, Orgo continues the open ChatGPT tab instead of Ctrl+Shift+O new chat. */
  continueThread?: boolean;
};

export type OrgoRelayResult = {
  replyText: string;
  durationMs: number;
  steps?: number;
  costCents?: number;
  continueThread: boolean;
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
    continueThread,
  });
  return buildOrgoAgentPrompt({ peerChatGptMessage, continueThread });
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  orgo?: { steps?: number; cost_cents?: number };
  error?: { message?: string };
};

/** Send a prompt to an Orgo computer; returns ChatGPT's reply text from the browser. */
export async function relayViaChatGptBrowser(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  const started = Date.now();
  const continueThread = Boolean(input.continueThread);
  const model = (process.env.ORGO_MODEL || "claude-sonnet-5").trim();
  const timeoutMs = Math.max(
    30_000,
    Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000
  );

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
        messages: [{ role: "user", content: buildChatGptRelayPrompt(input) }],
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
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Orgo relay timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
