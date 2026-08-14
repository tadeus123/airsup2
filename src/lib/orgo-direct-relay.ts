import { buildPeerChatGptMessage } from "./airsup-relay-prompt";
import type { OrgoRelayInput, OrgoRelayResult } from "./orgo";
import {
  orgoBash,
  orgoPressKey,
  orgoWait,
  orgoSetClipboard,
} from "./orgo-actions";

const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

function orgoApiKey(): string {
  return (process.env.ORGO_API_KEY || "").trim();
}

/** Minimal agent prompt — copy only, after direct hotkeys already sent the message. */
function buildCopyOnlyAgentPrompt(): string {
  return `The Airsup server already pasted a message into ChatGPT and pressed Enter.

Do ONLY this:
1. Focus the ChatGPT browser tab if needed.
2. Wait until ChatGPT has fully finished responding (no stop button, no loading).
3. Copy the LATEST assistant reply text only.
4. Return ONLY that text — no prefix, markdown, or explanation.

Do NOT type, send, or open new chats. Copy only.`;
}

async function agentCopyReply(computerId: string): Promise<string> {
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
        messages: [{ role: "user", content: buildCopyOnlyAgentPrompt() }],
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || raw.slice(0, 200));
    }
    const text = (json.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Copy agent returned empty reply");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Try to copy last ChatGPT reply via xdotool + clipboard (no LLM). */
async function bashCopyLastReply(computerId: string): Promise<string | null> {
  const script = `
set -e
command -v xdotool >/dev/null || exit 1
W=$(xdotool getactivewindow 2>/dev/null || true)
if [ -z "$W" ]; then exit 1; fi
xdotool mousemove --window "$W" 640 520 click 1
sleep 0.2
xdotool key ctrl+a
sleep 0.1
xdotool key ctrl+c
sleep 0.1
xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null
`.trim();
  try {
    const out = (await orgoBash(computerId, script)).trim();
    if (out.length < 2) return null;
    return out;
  } catch {
    return null;
  }
}

async function waitForChatGptReply(computerId: string): Promise<void> {
  const maxSec = Math.min(
    120,
    Math.max(15, Math.round((Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000) / 1000))
  );
  const chunk = 3;
  let elapsed = 0;
  while (elapsed < 12) {
    await orgoWait(computerId, chunk);
    elapsed += chunk;
  }
  while (elapsed < maxSec) {
    await orgoWait(computerId, chunk);
    elapsed += chunk;
  }
}

/**
 * Fast relay: deterministic hotkeys + clipboard (no agent for input).
 * Copy reply via bash first, tiny agent fallback if needed.
 */
export async function relayViaChatGptDirect(
  computerId: string,
  input: OrgoRelayInput
): Promise<OrgoRelayResult> {
  const started = Date.now();
  const continueThread = Boolean(input.continueThread);
  const peerText = buildPeerChatGptMessage({
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    message: input.message,
    conversationId: input.conversationId,
    continueThread,
  });

  if (!continueThread) {
    await orgoPressKey(computerId, "ctrl+shift+o");
    await orgoWait(computerId, 1.5);
  } else {
    await orgoWait(computerId, 0.3);
  }

  await orgoSetClipboard(computerId, peerText);
  await orgoPressKey(computerId, "ctrl+v");
  await orgoWait(computerId, 0.2);
  await orgoPressKey(computerId, "Return");

  await waitForChatGptReply(computerId);

  let replyText = (await bashCopyLastReply(computerId))?.trim() || "";
  if (!replyText || replyText.includes("[AIRSUP message from")) {
    replyText = await agentCopyReply(computerId);
  }

  if (!replyText) {
    throw new Error("Direct relay could not read ChatGPT reply");
  }

  return {
    replyText,
    durationMs: Date.now() - started,
    continueThread,
  };
}
