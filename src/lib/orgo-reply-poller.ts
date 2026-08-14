import {
  localSleep,
  orgoBash,
} from "./orgo-actions";
import { relayProgressMessage, type RelayStepReporter } from "./orgo-relay-progress";

function pollIntervalMs(): number {
  const ms = Number(process.env.ORGO_POLL_INTERVAL_MS || 1200);
  return Math.max(600, Math.min(ms, 5000));
}

function minWaitBeforeCopyMs(): number {
  const sec = Number(process.env.ORGO_MIN_WAIT_SEC || 1.2);
  return Math.max(800, Math.round(sec * 1000));
}

function maxWaitSec(): number {
  return Math.min(
    180,
    Math.max(20, Math.round((Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000) / 1000))
  );
}

function stablePollsRequired(): number {
  const n = Number(process.env.ORGO_REPLY_STABLE_POLLS || 1);
  return Math.max(1, Math.min(Math.floor(n), 3));
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

function chatWindowScript(body: string): string {
  return `
set -e
command -v xdotool >/dev/null || exit 1
W=$(xdotool search --class "chrome" 2>/dev/null | head -1)
[ -z "$W" ] && W=$(xdotool search --class "Chromium" 2>/dev/null | head -1)
[ -n "$W" ] || exit 1
xdotool windowfocus "$W"
${body}`.trim();
}

/** Copy entire ChatGPT thread via Ctrl+A (more reliable than partial select). */
export async function bashCopyWholeChat(computerId: string): Promise<string | null> {
  const script = chatWindowScript(`
sleep 0.04
xdotool mousemove --window "$W" 640 380 click 1
sleep 0.05
xdotool key End
sleep 0.06
xdotool key ctrl+a
sleep 0.08
xdotool key ctrl+c
sleep 0.06
xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null
`);
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

export type PollReplyResult = {
  replyText: string;
  waitedMs: number;
  stablePolls: number;
};

/**
 * Poll until ChatGPT reply is stable.
 * Uses local sleeps between attempts (not Orgo /wait) to avoid extra HTTP latency.
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
  const pollMs = pollIntervalMs();
  const minMs = minWaitBeforeCopyMs();
  const stableNeeded = stablePollsRequired();

  let lastCopy = "";
  let stableCount = 0;

  const progress = async (
    phase: "thinking" | "writing" | "verify",
    extra?: Partial<Parameters<typeof relayProgressMessage>[0]>
  ) => {
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const base = 52 + Math.min(35, Math.round((elapsedSec / maxWaitSec()) * 35));
    void report?.(
      relayProgressMessage({ peer, phase, elapsedSec, ...extra }),
      base
    );
  };

  while (Date.now() - started < maxMs) {
    const elapsed = Date.now() - started;

    if (elapsed < minMs) {
      await progress("thinking");
      await localSleep(Math.min(350, minMs - elapsed));
      continue;
    }

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
        if (stableNeeded === 1) {
          return {
            replyText: copy,
            waitedMs: elapsed,
            stablePolls: 1,
          };
        }
      }
    } else {
      lastCopy = "";
      stableCount = 0;
      await progress("thinking");
    }

    await localSleep(pollMs);
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
