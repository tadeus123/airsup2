import {
  localSleep,
  orgoClick,
  orgoPressKey,
  orgoReadClipboard,
} from "./orgo-actions";
import { relayProgressMessage, type RelayStepReporter } from "./orgo-relay-progress";

function pollIntervalMs(): number {
  const ms = Number(process.env.ORGO_POLL_INTERVAL_MS || 1500);
  return Math.max(800, Math.min(ms, 5000));
}

function minWaitBeforeCopyMs(): number {
  const sec = Number(process.env.ORGO_MIN_WAIT_SEC || 3);
  return Math.max(1500, Math.round(sec * 1000));
}

function maxWaitSec(): number {
  return Math.min(
    180,
    Math.max(20, Math.round((Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000) / 1000))
  );
}

export function looksLikeChatGptReply(text: string, sentBody: string): boolean {
  const t = text.trim();
  if (t.length < 1) return false;
  if (/^@\S+ · [a-f0-9]{8}\s*$/m.test(t)) return false;
  if (t.includes("[AIRSUP")) return false;
  const sent = sentBody.trim();
  if (sent.length > 20 && t.includes(sent.slice(0, Math.min(80, sent.length)))) {
    return false;
  }
  return true;
}

const PEER_HEADER_RE = /^@\S+ · [a-f0-9]{8}\s*$/gm;

export function extractLastAssistantReply(
  fullChat: string,
  sentBody: string
): string | null {
  const raw = fullChat.trim();
  if (!raw) return null;

  const headers = [...raw.matchAll(PEER_HEADER_RE)];
  const last = headers.at(-1);
  if (!last || last.index === undefined) {
    return looksLikeChatGptReply(raw, sentBody) ? raw : null;
  }

  let after = raw.slice(last.index + last[0].length).trim();
  const sent = sentBody.trim();

  if (sent) {
    if (after.startsWith(sent)) {
      after = after.slice(sent.length).trim();
    } else {
      const idx = after.indexOf(sent);
      if (idx >= 0) after = after.slice(idx + sent.length).trim();
    }
  }

  const nextHeader = after.search(/^@\S+ · [a-f0-9]{8}\s*$/m);
  if (nextHeader >= 0) after = after.slice(0, nextHeader).trim();

  after = after
    .replace(/^(?:ChatGPT|Assistant)(?:\s+said)?:?\s*\n+/i, "")
    .replace(/^You(?:\s+said)?:?\s*\n+/i, "")
    .trim();

  if (!after) return null;
  return looksLikeChatGptReply(after, sentBody) ? after : null;
}

async function copyWholeChat(computerId: string): Promise<string | null> {
  try {
    await orgoClick(computerId, 640, 380);
    await orgoPressKey(computerId, "End");
    await localSleep(80);
    await orgoPressKey(computerId, "ctrl+a");
    await localSleep(100);
    await orgoPressKey(computerId, "ctrl+c");
    await localSleep(80);
    const out = (await orgoReadClipboard(computerId)).trim();
    return out.length >= 1 ? out : null;
  } catch {
    return null;
  }
}

export async function bashCopyChatGptReply(
  computerId: string,
  sentBody: string
): Promise<string | null> {
  const whole = await copyWholeChat(computerId);
  if (!whole) return null;
  return extractLastAssistantReply(whole, sentBody);
}

export type PollReplyResult = {
  replyText: string;
  waitedMs: number;
  stablePolls: number;
};

export async function pollUntilChatGptReply(
  computerId: string,
  sentBody: string,
  opts?: { peer?: string; onProgress?: RelayStepReporter }
): Promise<PollReplyResult> {
  const peer = opts?.peer ?? "peer";
  const report = opts?.onProgress;
  const started = Date.now();
  const maxMs = maxWaitSec() * 1000;
  const pollMs = pollIntervalMs();
  const minMs = minWaitBeforeCopyMs();

  const progress = async (phase: "thinking" | "writing") => {
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const base = 52 + Math.min(35, Math.round((elapsedSec / maxWaitSec()) * 35));
    void report?.(relayProgressMessage({ peer, phase, elapsedSec }), base);
  };

  while (Date.now() - started < maxMs) {
    const elapsed = Date.now() - started;
    if (elapsed < minMs) {
      await progress("thinking");
      await localSleep(Math.min(400, minMs - elapsed));
      continue;
    }

    const copy = (await bashCopyChatGptReply(computerId, sentBody))?.trim() ?? "";
    if (copy && looksLikeChatGptReply(copy, sentBody)) {
      await progress("writing");
      return { replyText: copy, waitedMs: elapsed, stablePolls: 1 };
    }

    await progress("thinking");
    await localSleep(pollMs);
  }

  throw new Error(`ChatGPT reply not ready within ${maxWaitSec()}s`);
}
