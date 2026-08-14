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

const UI_MARKERS = [
  /new chat/i,
  /search chats/i,
  /^library$/im,
  /^projects$/im,
  /^gpts$/im,
  /ask anything/i,
  /chatgpt plus/i,
  /worked for \d+s/i,
  /^\s*copy\s*$/im,
  /^\s*share\s*$/im,
  /^\s*regenerate\s*$/im,
];

/** Clipboard looks like a full-page ChatGPT UI dump, not a reply. */
export function looksLikeUiCapture(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  let hits = 0;
  for (const re of UI_MARKERS) {
    if (re.test(t)) hits += 1;
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 25 && hits >= 1) return true;
  if (hits >= 2) return true;
  return false;
}

/** Copied text looks like a ChatGPT reply, not our outbound paste or UI chrome. */
export function looksLikeChatGptReply(text: string, sentBody: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (looksLikeUiCapture(t)) return false;
  if (/^@\S+ · [a-f0-9]{8}\s*$/m.test(t)) return false;
  if (/^From @\S+:\s*$/m.test(t)) return false;
  if (t.includes("[AIRSUP")) return false;
  if (/^what should i (send|ask|tell)/im.test(t)) return false;
  const sent = sentBody.trim();
  if (sent.length > 15 && t.includes(sent.slice(0, Math.min(80, sent.length)))) {
    return false;
  }
  if (/^From @\S+:\s*\n/im.test(t)) return false;
  return true;
}

/** Strip our outbound message prefix from copied chat text. */
function stripSentMessage(raw: string, sentPeerText: string, sentBody: string): string {
  let after = raw.trim();
  const peer = sentPeerText.trim();
  const body = sentBody.trim();

  if (peer && after.includes(peer)) {
    after = after.slice(after.lastIndexOf(peer) + peer.length).trim();
  } else if (body) {
    const idx = after.lastIndexOf(body);
    if (idx >= 0) after = after.slice(idx + body.length).trim();
  }

  return after
    .replace(/^(?:ChatGPT|Assistant)(?:\s+said)?:?\s*\n+/i, "")
    .replace(/^You(?:\s+said)?:?\s*\n+/i, "")
    .replace(/^From @\S+:\s*\n*/i, "")
    .trim();
}

/**
 * Parse the last assistant reply from copied chat text.
 * Handles both partial selection and accidental full-page copies.
 */
export function extractLastAssistantReply(
  fullChat: string,
  sentBody: string,
  sentPeerText?: string
): string | null {
  const raw = fullChat.trim();
  if (!raw) return null;

  const peer = (sentPeerText || sentBody).trim();
  let after = stripSentMessage(raw, peer, sentBody);

  // Full-page copy: take the last non-empty paragraph block after our message.
  if (looksLikeUiCapture(raw) || after.length > 800) {
    const chunks = after
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      const chunk = chunks[i]!;
      if (looksLikeChatGptReply(chunk, sentBody)) return chunk;
    }
    return null;
  }

  // Trim at next "From @user:" if multiple messages in selection.
  const nextFrom = after.search(/^From @\S+:/m);
  if (nextFrom >= 0) after = after.slice(0, nextFrom).trim();

  if (!after) return null;
  return looksLikeChatGptReply(after, sentBody) ? after : null;
}

/** Select and copy the last assistant message (avoid Ctrl+A sidebar dump). */
async function copyLastReplyBlock(computerId: string): Promise<string | null> {
  try {
    await orgoClick(computerId, 640, 380);
    await localSleep(60);
    await orgoPressKey(computerId, "End");
    await localSleep(60);
    for (let i = 0; i < 14; i += 1) {
      await orgoPressKey(computerId, "shift+Up");
      await localSleep(25);
    }
    await orgoPressKey(computerId, "ctrl+c");
    await localSleep(80);
    const out = (await orgoReadClipboard(computerId)).trim();
    return out.length >= 1 ? out : null;
  } catch {
    return null;
  }
}

/** Fallback: whole chat copy when line selection fails. */
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
  sentBody: string,
  sentPeerText?: string
): Promise<string | null> {
  const partial = await copyLastReplyBlock(computerId);
  if (partial) {
    const parsed = extractLastAssistantReply(partial, sentBody, sentPeerText);
    if (parsed) return parsed;
  }
  const whole = await copyWholeChat(computerId);
  if (!whole) return null;
  return extractLastAssistantReply(whole, sentBody, sentPeerText);
}

export type PollReplyResult = {
  replyText: string;
  waitedMs: number;
  stablePolls: number;
};

export async function pollUntilChatGptReply(
  computerId: string,
  sentBody: string,
  opts?: { peer?: string; sentPeerText?: string; onProgress?: RelayStepReporter }
): Promise<PollReplyResult> {
  const peer = opts?.peer ?? "peer";
  const sentPeerText = opts?.sentPeerText ?? sentBody;
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

    const copy =
      (await bashCopyChatGptReply(computerId, sentBody, sentPeerText))?.trim() ?? "";
    if (copy && looksLikeChatGptReply(copy, sentBody)) {
      await progress("writing");
      return { replyText: copy, waitedMs: elapsed, stablePolls: 1 };
    }

    await progress("thinking");
    await localSleep(pollMs);
  }

  throw new Error(`ChatGPT reply not ready within ${maxWaitSec()}s`);
}
