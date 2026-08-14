import { createHash } from "node:crypto";
import {
  orgoBash,
  orgoScreenshotB64,
  orgoWait,
} from "./orgo-actions";
import { relayProgressMessage, type RelayStepReporter } from "./orgo-relay-progress";

function pollIntervalSec(): number {
  const ms = Number(process.env.ORGO_POLL_INTERVAL_MS || 1500);
  return Math.max(0.8, Math.min(ms / 1000, 5));
}

function minWaitBeforeCopySec(): number {
  return Math.max(1.5, Number(process.env.ORGO_MIN_WAIT_SEC || 2));
}

function maxWaitSec(): number {
  return Math.min(
    180,
    Math.max(20, Math.round((Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000) / 1000))
  );
}

function stablePollsRequired(): number {
  const n = Number(process.env.ORGO_REPLY_STABLE_POLLS || 2);
  return Math.max(2, Math.min(Math.floor(n), 4));
}

/** Copied text looks like a ChatGPT reply, not our outbound paste. */
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

/**
 * Parse the last assistant reply from a full ChatGPT thread copy (Ctrl+A).
 * Peer messages use "@user · threadId" header; reply follows the message body.
 */
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

/** Copy entire ChatGPT thread via Ctrl+A (more reliable than partial select). */
export async function bashCopyWholeChat(computerId: string): Promise<string | null> {
  const script = `
set -e
command -v xdotool >/dev/null || exit 1
W=$(xdotool getactivewindow 2>/dev/null || true)
[ -n "$W" ] || exit 1
xdotool windowfocus "$W"
xdotool key End
sleep 0.2
xdotool mousemove --window "$W" 640 380 click 1
sleep 0.1
xdotool key ctrl+a
sleep 0.15
xdotool key ctrl+c
sleep 0.1
xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null
`.trim();
  try {
    const out = (await orgoBash(computerId, script)).trim();
    return out.length >= 1 ? out : null;
  } catch {
    return null;
  }
}

/** Copy thread and extract the latest assistant reply. */
export async function bashCopyChatGptReply(
  computerId: string,
  sentBody: string
): Promise<string | null> {
  const whole = await bashCopyWholeChat(computerId);
  if (!whole) return null;
  return extractLastAssistantReply(whole, sentBody);
}

function hashScreenshot(b64: string): string {
  return createHash("sha256").update(b64.slice(0, 8000)).digest("hex").slice(0, 16);
}

export type PollReplyResult = {
  replyText: string;
  waitedMs: number;
  stablePolls: number;
};

/**
 * Poll until ChatGPT reply is stable — no fixed 120s wait.
 * Returns as soon as the same valid copy appears N times in a row
 * (reply finished streaming) or screen stops changing + valid copy.
 */
export async function pollUntilChatGptReply(
  computerId: string,
  sentBody: string,
  opts?: { peer?: string; onProgress?: RelayStepReporter }
): Promise<PollReplyResult> {
  const peer = opts?.peer ?? "peer";
  const report = opts?.onProgress;
  const started = Date.now();
  const maxMs = maxWaitSec() * 1000;
  const pollSec = pollIntervalSec();
  const minMs = minWaitBeforeCopySec() * 1000;
  const stableNeeded = stablePollsRequired();

  let lastCopy = "";
  let stableCount = 0;
  let lastScreen = "";

  const progress = async (phase: "thinking" | "writing" | "verify", extra?: Partial<Parameters<typeof relayProgressMessage>[0]>) => {
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const base = 52 + Math.min(35, Math.round((elapsedSec / maxWaitSec()) * 35));
    await report?.(
      relayProgressMessage({ peer, phase, elapsedSec, ...extra }),
      base
    );
  };

  while (Date.now() - started < maxMs) {
    const elapsed = Date.now() - started;
    const elapsedSec = Math.round(elapsed / 1000);

    try {
      const shot = await orgoScreenshotB64(computerId);
      const h = hashScreenshot(shot);
      if (h !== lastScreen) lastScreen = h;
    } catch {
      // optional
    }

    if (elapsed < minMs) {
      await progress("thinking");
    } else {
      const copy = (await bashCopyChatGptReply(computerId, sentBody))?.trim() ?? "";
      if (copy && looksLikeChatGptReply(copy, sentBody)) {
        if (copy === lastCopy) {
          stableCount += 1;
          await progress("verify", {
            stable: stableCount,
            stableNeeded,
            charCount: copy.length,
          });
          if (stableCount >= stableNeeded) {
            return {
              replyText: copy,
              waitedMs: elapsed,
              stablePolls: stableCount,
            };
          }
        } else {
          lastCopy = copy;
          stableCount = 1;
          await progress("writing", {
            charCount: copy.length,
            preview: copy,
          });
        }
      } else {
        lastCopy = "";
        stableCount = 0;
        await progress("thinking");
      }
    }

    await orgoWait(computerId, pollSec);
  }

  const final = (await bashCopyChatGptReply(computerId, sentBody))?.trim() ?? "";
  if (final && looksLikeChatGptReply(final, sentBody)) {
    return {
      replyText: final,
      waitedMs: Date.now() - started,
      stablePolls: 0,
    };
  }

  throw new Error(`ChatGPT reply not ready within ${maxWaitSec()}s`);
}
