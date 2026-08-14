import { buildPeerChatGptMessage } from "./airsup-relay-prompt";
import type { OrgoRelayInput, OrgoRelayResult } from "./orgo";
import {
  orgoPressKey,
  orgoSetClipboard,
  orgoWait,
} from "./orgo-actions";
import { relayProgressMessage } from "./orgo-relay-progress";
import { looksLikeChatGptReply, pollUntilChatGptReply } from "./orgo-reply-poller";

const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

function orgoApiKey(): string {
  return (process.env.ORGO_API_KEY || "").trim();
}

function buildCopyOnlyAgentPrompt(): string {
  return `ChatGPT already received the message and should have replied.

Do ONLY this:
1. Focus ChatGPT in the browser.
2. If still generating, wait until fully done (no stop button).
3. Copy the LATEST assistant reply only.
4. Return ONLY that text — no wrapper.

Do NOT send messages or open new chats.`;
}

async function agentCopyReply(computerId: string): Promise<string> {
  const model = (process.env.ORGO_MODEL || "claude-sonnet-5").trim();
  const timeoutMs = Math.min(
    60_000,
    Math.max(20_000, Number(process.env.ORGO_COPY_TIMEOUT_MS || 45_000) || 45_000)
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
    await report?.(
      relayProgressMessage({ peer, phase: "new_chat" }),
      32
    );
    await orgoPressKey(computerId, "ctrl+shift+o");
    await orgoWait(computerId, 1);
  } else {
    await report?.(
      relayProgressMessage({ peer, phase: "continue_thread" }),
      32
    );
    await orgoWait(computerId, 0.15);
  }

  await report?.(relayProgressMessage({ peer, phase: "paste" }), 40);
  await orgoSetClipboard(computerId, peerText);
  await orgoPressKey(computerId, "ctrl+v");
  await orgoWait(computerId, 0.1);
  await orgoPressKey(computerId, "Return");

  await report?.(relayProgressMessage({ peer, phase: "sent" }), 48);

  let replyText: string;
  try {
    const polled = await pollUntilChatGptReply(computerId, input.message, {
      peer,
      onProgress: report,
    });
    replyText = polled.replyText;
    await report?.(
      relayProgressMessage({
        peer,
        phase: "done",
        elapsedSec: Math.round((Date.now() - started) / 1000),
      }),
      92
    );
  } catch {
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    await report?.(
      relayProgressMessage({ peer, phase: "copy_agent", elapsedSec }),
      85
    );
    replyText = await agentCopyReply(computerId);
    if (!looksLikeChatGptReply(replyText, input.message)) {
      throw new Error("Could not read a valid ChatGPT reply");
    }
    await report?.(
      relayProgressMessage({ peer, phase: "done", elapsedSec }),
      92
    );
  }

  return {
    replyText,
    durationMs: Date.now() - started,
    continueThread,
  };
}
