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
  return `You are an Airsup relay. ChatGPT is already open and logged in in the browser.

Do ONLY these steps, in order:

1. Click the browser window with ChatGPT so it is focused.
2. Press Ctrl+Shift+O (Strg+Shift+O) to open a NEW ChatGPT chat. Do NOT click menus — use this keyboard shortcut.
3. Click the message input box if it is not focused.
4. Paste this FULL prompt into the input (Ctrl+V). If paste fails, type it exactly as written:

${message}

5. Press Enter.
6. Wait until ChatGPT has FULLY finished responding (no stop button, no loading spinner).
7. Select and copy ChatGPT's complete answer text.
8. Return ONLY that copied answer to Airsup — no prefix, no explanation, no markdown.

Do NOT open terminal, other apps, or other websites. Do NOT add "from ${from}" or any wrapper to the pasted prompt.

If ChatGPT shows an error, return that error text as-is.`;
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
