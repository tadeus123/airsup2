import { createHash } from "node:crypto";
import {
  orgoBash,
  orgoScreenshotB64,
  orgoWait,
} from "./orgo-actions";
import { relayProgressMessage, type RelayStepReporter } from "./orgo-relay-progress";

function pollIntervalSec(): number {
  const ms = Number(process.env.ORGO_POLL_INTERVAL_MS || 2000);
  return Math.max(1, Math.min(ms / 1000, 5));
}

function minWaitBeforeCopySec(): number {
  return Math.max(2, Number(process.env.ORGO_MIN_WAIT_SEC || 3));
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

/** Copied text looks like a ChatGPT reply, not our outbound AIRSUP prompt. */
export function looksLikeChatGptReply(text: string, sentBody: string): boolean {
  const t = text.trim();
  if (t.length < 1) return false;
  if (t.includes("[AIRSUP message from") || t.includes("[AIRSUP follow-up from")) {
    return false;
  }
  if (t.includes("Airsup rules (recipient's ChatGPT)")) return false;
  const sent = sentBody.trim();
  if (sent.length > 20 && t.includes(sent.slice(0, Math.min(80, sent.length)))) {
    return false;
  }
  return true;
}

const AIRSUP_RULES_MARKER = "Airsup rules (recipient's ChatGPT):";

/**
 * Parse the last assistant reply from a full ChatGPT thread copy (Ctrl+A).
 * Our AIRSUP user turn ends with a rules block; the assistant reply follows it.
 */
export function extractLastAssistantReply(
  fullChat: string,
  sentBody: string
): string | null {
  const raw = fullChat.trim();
  if (!raw) return null;

  let replyStart = -1;
  let pos = 0;
  while (pos < raw.length) {
    const idx = raw.indexOf(AIRSUP_RULES_MARKER, pos);
    if (idx < 0) break;
    const afterRules = raw.slice(idx + AIRSUP_RULES_MARKER.length);
    const blank = afterRules.match(/[\s\S]*?\n\n/);
    replyStart = idx + AIRSUP_RULES_MARKER.length + (blank ? blank[0].length : 0);
    pos = idx + AIRSUP_RULES_MARKER.length;
  }

  let reply =
    replyStart >= 0
      ? raw.slice(replyStart).trim()
      : raw;

  const nextTurn = reply.search(/\n\[AIRSUP (?:message|follow-up) from/);
  if (nextTurn >= 0) reply = reply.slice(0, nextTurn).trim();

  reply = reply
    .replace(/^(?:ChatGPT|Assistant)(?:\s+said)?:?\s*\n+/i, "")
    .replace(/^You(?:\s+said)?:?\s*\n+/i, "")
    .trim();

  if (!reply) return null;
  return looksLikeChatGptReply(reply, sentBody) ? reply : null;
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
