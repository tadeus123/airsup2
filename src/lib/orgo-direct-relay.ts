import { buildPeerChatGptMessage } from "./airsup-relay-prompt";
import type { OrgoRelayInput, OrgoRelayResult } from "./orgo";
import {
  orgoPrepFreshChatGptChat,
  orgoSendPeerMessage,
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
  return `FAST. Max 3 steps. ChatGPT already has the message.
Wait if still generating. Copy LATEST assistant reply only. Return ONLY that text.
Do NOT send, paste, or open chats.`;
}

/** Copy-only Orgo agent — used when hotkeys already pasted the message. */
export async function agentCopyReply(computerId: string): Promise<string> {
  const model = (process.env.ORGO_MODEL || "claude-sonnet-5").trim();
  const timeoutMs = Math.min(
    60_000,
    Math.max(15_000, Number(process.env.ORGO_COPY_TIMEOUT_MS || 30_000) || 30_000)
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

export type DirectRelayResult = OrgoRelayResult & {
  /** Message was pasted; a copy-only retry is safe (no duplicate send). */
  pasteSent: boolean;
  /** Per-phase timing for diagnostics (ms). */
  timing?: Record<string, number>;
};

export async function relayViaChatGptDirect(
  computerId: string,
  input: OrgoRelayInput
): Promise<DirectRelayResult> {
  const started = Date.now();
  const timing: Record<string, number> = {};
  const mark = (name: string) => {
    timing[name] = Date.now() - started;
  };

  const continueThread = Boolean(input.continueThread);
  const parallel = Boolean(input.parallelWithOthers);
  const peer = input.peerUsername || "peer";
  const report = input.onProgress;
  const peerText = buildPeerChatGptMessage({
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    message: input.message,
    conversationId: input.conversationId,
    continueThread,
  });

  const pasteMode = continueThread
    ? "continue"
    : parallel
      ? "parallel_new"
      : "ready";

  void report?.(
    relayProgressMessage({
      peer,
      phase: continueThread
        ? "continue_thread"
        : parallel
          ? "new_chat"
          : "paste",
    }),
    32
  );

  const tPaste0 = Date.now();
  await orgoSendPeerMessage(computerId, peerText, pasteMode);
  timing.paste_ms = Date.now() - tPaste0;
  mark("paste_done");

  void report?.(relayProgressMessage({ peer, phase: "sent" }), 48);

  let replyText: string;
  const tPoll0 = Date.now();
  try {
    const polled = await pollUntilChatGptReply(computerId, input.message, {
      peer,
      onProgress: report,
    });
    replyText = polled.replyText;
    timing.poll_ms = Date.now() - tPoll0;
    timing.stable_polls = polled.stablePolls;
    mark("poll_done");
    void report?.(
      relayProgressMessage({
        peer,
        phase: "done",
        elapsedSec: Math.round((Date.now() - started) / 1000),
      }),
      92
    );
  } catch {
    timing.poll_ms = Date.now() - tPoll0;
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    void report?.(
      relayProgressMessage({ peer, phase: "copy_agent", elapsedSec }),
      85
    );
    const tCopy0 = Date.now();
    replyText = await agentCopyReply(computerId);
    timing.copy_agent_ms = Date.now() - tCopy0;
    if (!looksLikeChatGptReply(replyText, input.message)) {
      const err = new Error("Could not read a valid ChatGPT reply");
      (err as Error & { pasteSent?: boolean }).pasteSent = true;
      throw err;
    }
    void report?.(
      relayProgressMessage({ peer, phase: "done", elapsedSec }),
      92
    );
  }

  if (!continueThread && !parallel) {
    void orgoPrepFreshChatGptChat(computerId).catch(() => {});
  }

  timing.total_ms = Date.now() - started;
  if (timing.total_ms > 15_000) {
    console.info("[orgo] relay timing", { peer, ...timing, continueThread, parallel });
  }

  return {
    replyText,
    durationMs: Date.now() - started,
    continueThread,
    pasteSent: true,
    timing,
  };
}
