const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

export type OrgoRelayInput = {
  fromUsername: string;
  message: string;
};

export type OrgoRelayResult = {
  replyText: string;
  durationMs: number;
  steps?: number;
  costCents?: number;
};

function orgoApiKey(): string {
  const key = (process.env.ORGO_API_KEY || "").trim();
  if (!key) throw new Error("ORGO_API_KEY is not configured");
  return key;
}

/** Prompt Orgo's computer-use agent to relay a message through the open ChatGPT browser tab. */
export function buildChatGptRelayPrompt(input: OrgoRelayInput): string {
  const from = input.fromUsername.trim();
  const message = input.message.trim();
  return `You are an Airsup message relay. ChatGPT is ALREADY open and logged in in the browser on this desktop.

STRICT RULES — follow exactly:
1. Use ONLY the existing ChatGPT browser tab. Do NOT open terminal, new apps, or other websites.
2. If the browser is not focused, click the Chrome/Chromium window showing ChatGPT first.
3. Start a NEW ChatGPT chat: press Ctrl+Shift+O (or click ChatGPT's "New chat" button).
4. Click the ChatGPT message input box.
5. Type the following message EXACTLY (do not add prefixes or explain who sent it):
${message}
6. Press Enter and wait until ChatGPT's response is FULLY complete (the stop button must be gone).
7. Copy the assistant's full response text (not your own commentary).
8. Return ONLY the copied ChatGPT response as your final answer — no markdown, no quotes, no explanation, no "Here is the response".

Context (do not repeat in the chat): this message came from Airsup user "${from}".

If the input box is not ready, wait briefly and retry. If ChatGPT shows an error, return that error text.`;
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
        messages: [
          { role: "user", content: buildChatGptRelayPrompt(input) },
        ],
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
