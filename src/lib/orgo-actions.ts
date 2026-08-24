import { readFileSync } from "fs";
import { join } from "path";

import { logActivitySafe } from "./activity";

const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

function orgoApiKey(): string {
  const key = (process.env.ORGO_API_KEY || "").trim();
  if (!key) throw new Error("ORGO_API_KEY is not configured");
  return key;
}

export async function orgoBash(computerId: string, command: string): Promise<string> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/bash`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo bash failed (${res.status}): ${raw.slice(0, 200)}`);
  }
  try {
    const json = JSON.parse(raw) as { stdout?: string; output?: string; result?: string };
    return (json.stdout ?? json.output ?? json.result ?? raw).trim();
  } catch {
    return raw.trim();
  }
}

const DISPLAY_SETUP = `
export DISPLAY=:99
export XAUTHORITY=/home/orgo/.Xauthority
`;

const VM_SEND_PATH = "/tmp/airsup-chatgpt-send.js";

function loadVmSendScript(): string {
  const candidates = [
    join(process.cwd(), "src/lib/vm/airsup-chatgpt-send.js"),
    join(__dirname, "vm/airsup-chatgpt-send.js"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("airsup-chatgpt-send.js missing from deployment bundle");
}

async function deployVmSendScript(computerId: string): Promise<void> {
  const script = loadVmSendScript();
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const out = await orgoBash(
    computerId,
    `python3 - <<'PY'
import base64, os
raw = base64.b64decode("${b64}")
open("${VM_SEND_PATH}", "wb").write(raw)
os.chmod("${VM_SEND_PATH}", 0o755)
print("ok", len(raw))
PY`
  );
  if (!/\bok\b/.test(out)) {
    throw new Error(`deployVmSendScript failed: ${out.slice(0, 200)}`);
  }
}

function parseCdpResult(out: string): {
  ok?: boolean;
  error?: string;
  verified?: boolean;
  method?: string;
} | null {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1)) as {
      ok?: boolean;
      error?: string;
      verified?: boolean;
      method?: string;
    };
  } catch {
    return null;
  }
}

/** True if ChatGPT is already a logged-in session in Chrome (disk cookies persist). */
export async function getChatGptAuthState(
  computerId: string
): Promise<{ loggedIn: boolean; url: string }> {
  const out = await orgoBash(
    computerId,
    `curl -sS --max-time 2 http://127.0.0.1:9222/json/list 2>/dev/null || echo '[]'`
  );
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start < 0 || end <= start) return { loggedIn: false, url: "" };
  try {
    const pages = JSON.parse(out.slice(start, end + 1)) as Array<{ url?: string }>;
    const page = pages.find((p) => /chatgpt\.com|openai\.com/i.test(p.url || ""));
    const url = (page?.url || pages[0]?.url || "").trim();
    const loggedIn = /chatgpt\.com/i.test(url) && !/\/auth\/|\/log-in|\/login/i.test(url);
    return { loggedIn, url };
  } catch {
    return { loggedIn: false, url: "" };
  }
}

async function runVmSend(
  computerId: string,
  text: string,
  newChat: boolean,
  mode: "send" | "verify" = "send"
): Promise<{ ok: boolean; error?: string; raw: string; parsed: ReturnType<typeof parseCdpResult> }> {
  await deployVmSendScript(computerId);
  const textB64 = Buffer.from(text, "utf8").toString("base64");
  const flag = newChat ? "1" : "0";
  const out = await orgoBash(
    computerId,
    `node ${VM_SEND_PATH} ${textB64} ${flag} ${mode}`
  );
  const parsed = parseCdpResult(out);
  return {
    ok: !!parsed?.ok,
    error: parsed?.error || (!parsed ? out.slice(0, 240) : undefined),
    raw: out,
    parsed,
  };
}

async function orgoSendChatViaCdp(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  const first = await runVmSend(computerId, text, newChat, "send");
  if (first.ok) return;

  // One hard Chrome recycle then retry — fixes stale CDP / navigated targets.
  await orgoBash(
    computerId,
    `${DISPLAY_SETUP}
pkill -9 -f '/opt/google/chrome/chrome' 2>/dev/null || true
pkill -9 -f 'google-chrome' 2>/dev/null || true
sleep 1
echo KILLED`
  );
  await localSleep(1500);
  const second = await runVmSend(computerId, text, newChat, "send");
  if (second.ok) return;
  throw new Error(
    `CDP send failed: ${(second.error || first.error || "unknown").slice(0, 240)}`
  );
}

/**
 * Blind keystrokes only — must be verified via CDP afterwards.
 * Never treat this alone as delivery success.
 */
async function orgoSendChatViaXdotool(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const spot = newChat ? { x: 720, y: 400 } : { x: 720, y: 650 };
  const openNew = newChat
    ? `xdotool key --clearmodifiers ctrl+shift+o
sleep 1.0
`
    : "";

  const out = await orgoBash(
    computerId,
    `set -e
${DISPLAY_SETUP}
command -v xdotool >/dev/null || { echo "xdotool missing"; exit 1; }
f=/tmp/airsup-send-clip.$$
echo '${b64}' | base64 -d > "$f" || exit 1
xclip -selection clipboard -i "$f" >/dev/null 2>&1 || xsel --clipboard --input < "$f"
# Focus Chrome if present
wid=$(xdotool search --class 'chrome|Chrome|google-chrome' 2>/dev/null | head -1 || true)
if [ -n "$wid" ]; then xdotool windowactivate --sync "$wid" 2>/dev/null || true; fi
xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Meta_L Meta_R 2>/dev/null || true
${openNew}xdotool mousemove ${spot.x} ${spot.y} click 1
sleep 0.25
xdotool key --clearmodifiers ctrl+a
xdotool key --clearmodifiers ctrl+v
sleep 0.45
xdotool key --clearmodifiers Return
sleep 0.8
rm -f "$f"
echo SENT`
  );

  if (!/\bSENT\b/.test(out)) {
    throw new Error(`xdotool send failed: ${out.slice(0, 240)}`);
  }
}

async function verifyWakeInChat(computerId: string, text: string): Promise<boolean> {
  const v = await runVmSend(computerId, text, false, "verify");
  return v.ok;
}

/** Send text into ChatGPT on an Orgo desktop. Success only if DOM verifies the wake. */
export async function orgoSendChat(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  try {
    await orgoSendChatViaCdp(computerId, text, newChat);
    logActivitySafe({
      kind: "orgo_send",
      ok: true,
      computerId,
      summary: `Orgo CDP send verified (newChat=${newChat})`,
      detail: { method: "cdp", newChat, textLen: text.length, verified: true },
    });
    return;
  } catch (cdpErr) {
    const cdpMsg = cdpErr instanceof Error ? cdpErr.message : String(cdpErr);
    logActivitySafe({
      kind: "orgo_send",
      ok: false,
      severity: "warn",
      computerId,
      summary: `Orgo CDP failed, trying xdotool+verify: ${cdpMsg.slice(0, 120)}`,
      detail: { method: "cdp", error: cdpMsg.slice(0, 240), newChat },
    });
  }

  try {
    await orgoSendChatViaXdotool(computerId, text, newChat);
    await localSleep(800);
    const verified = await verifyWakeInChat(computerId, text);
    if (!verified) {
      // Last attempt: full CDP send after focusing UI
      await orgoSendChatViaCdp(computerId, text, newChat);
      logActivitySafe({
        kind: "orgo_send",
        ok: true,
        severity: "warn",
        computerId,
        summary: `Orgo send recovered via CDP after xdotool (newChat=${newChat})`,
        detail: { method: "xdotool_then_cdp", newChat, textLen: text.length, verified: true },
      });
      return;
    }
    logActivitySafe({
      kind: "orgo_send",
      ok: true,
      severity: "warn",
      computerId,
      summary: `Orgo xdotool send verified in ChatGPT (newChat=${newChat})`,
      detail: { method: "xdotool_verified", newChat, textLen: text.length, verified: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logActivitySafe({
      kind: "orgo_send",
      ok: false,
      computerId,
      summary: `Orgo send failed (unverified): ${msg.slice(0, 120)}`,
      detail: {
        method: "both_failed",
        error: msg.slice(0, 240),
        newChat,
      },
    });
    throw new Error(
      `Could not inject into ChatGPT on Orgo (message stored, wake not delivered): ${msg.slice(0, 180)}`
    );
  }
}

export type OrgoLoginAgentResult = {
  status: "signed_in" | "needs_2fa" | "failed";
  message: string;
  threadId?: string;
};

function parseOrgoAgentResponse(raw: string): {
  message: string;
  threadId?: string;
} {
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      orgo?: { thread_id?: string };
    };
    return {
      message: (json.choices?.[0]?.message?.content || "").trim(),
      threadId: json.orgo?.thread_id?.trim() || undefined,
    };
  } catch {
    return { message: raw.slice(0, 400) };
  }
}

function classifyLoginMessage(message: string): OrgoLoginAgentResult["status"] {
  // Only trust explicit tokens — fuzzy "verification code" falsely matches Google SSO.
  if (/\bSIGNED_IN\b/i.test(message)) return "signed_in";
  if (/\bNEEDS_2FA\b/i.test(message)) return "needs_2fa";
  if (/\bFAILED\b/i.test(message)) return "failed";
  return "failed";
}

/** Ask Orgo's computer-use agent to sign into ChatGPT with the given credentials. */
export async function signInChatGptViaOrgoAgent(
  computerId: string,
  email: string,
  password: string
): Promise<OrgoLoginAgentResult> {
  const prompt = [
    "Sign the user into ChatGPT on this computer. Move fast.",
    "",
    "Credentials:",
    `email: ${email}`,
    `password: ${password}`,
    "",
    "Rules:",
    "- Be fast: no pauses, no extra browsing, no commentary on screen",
    "- Open Chrome if needed and go straight to https://chatgpt.com/auth/login",
    "- Prefer ChatGPT email + password if that option is available",
    "- If ChatGPT only offers Google / Continue with Google (common for work emails on a custom domain, not only @gmail.com), use Google with THIS SAME email and password — that is correct, not a failure",
    "- On Google screens: pick the matching account if shown, click Continue/Next when asked, enter password if asked",
    "- Google phone / device prompts / 'approve on your phone' / account chooser / Continue buttons are NOT ChatGPT authenticator 2FA — click through them; do NOT reply NEEDS_2FA for those",
    "- Only reply NEEDS_2FA if ChatGPT itself shows an authenticator / TOTP / 6-digit app code field (not Google, not SMS to a phone for Google)",
    "- Enter the email, continue, enter the password, continue/sign in",
    "- Handle Cloudflare/captcha if it appears (click the checkbox quickly)",
    "- If the password is rejected / wrong password / incorrect credentials, STOP and reply exactly: FAILED: wrong password",
    "- Do not invent a code. Do not keep guessing passwords.",
    "- Do not stop until ChatGPT is fully signed in (main chat UI visible, not the login page), unless ChatGPT authenticator 2FA is required",
    "- Keep trying until it works. Retry on UI mistakes immediately.",
    "- When fully signed in, reply with exactly: SIGNED_IN",
    "- If impossible after many attempts (and not ChatGPT authenticator 2FA), reply with: FAILED: <short reason>",
  ].join("\n");

  const res = await fetch(`${ORGO_API_BASE}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ORGO_LOGIN_MODEL?.trim() || "claude-sonnet-5",
      computer_id: computerId,
      max_steps: 60,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo agent login failed (${res.status}): ${raw.slice(0, 240)}`);
  }

  const { message, threadId } = parseOrgoAgentResponse(raw);
  return { status: classifyLoginMessage(message), message, threadId };
}

/** Continue Orgo login thread after the user provides a 2FA / TOTP code. */
export async function continueChatGptLoginWith2fa(
  computerId: string,
  threadId: string,
  code: string
): Promise<OrgoLoginAgentResult> {
  const prompt = [
    "Continue signing into ChatGPT. Move fast.",
    "",
    `The ChatGPT authenticator / TOTP code is: ${code.trim()}`,
    "",
    "Rules:",
    "- Enter this code only into a ChatGPT authenticator / 2FA field",
    "- If you are on a Google screen (Continue, account picker, phone prompt), do NOT treat that as this code — click Continue/Next instead, then reply FAILED: not a chatgpt authenticator prompt",
    "- Submit / continue immediately after entering the code",
    "- If the code is rejected, reply: FAILED: invalid 2fa code",
    "- When ChatGPT main chat UI is visible, reply exactly: SIGNED_IN",
    "- Do not ask for another code in prose — if another ChatGPT authenticator code is needed reply: NEEDS_2FA",
  ].join("\n");

  const res = await fetch(`${ORGO_API_BASE}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ORGO_LOGIN_MODEL?.trim() || "claude-sonnet-5",
      computer_id: computerId,
      thread_id: threadId,
      max_steps: 40,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo 2FA continue failed (${res.status}): ${raw.slice(0, 240)}`);
  }

  const parsed = parseOrgoAgentResponse(raw);
  return {
    status: classifyLoginMessage(parsed.message),
    message: parsed.message,
    threadId: parsed.threadId || threadId,
  };
}

export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
