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

function parseCdpResult(out: string): { ok?: boolean; error?: string } | null {
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1)) as { ok?: boolean; error?: string };
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

async function orgoSendChatViaCdp(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  await deployVmSendScript(computerId);
  const textB64 = Buffer.from(text, "utf8").toString("base64");
  const flag = newChat ? "1" : "0";
  const out = await orgoBash(
    computerId,
    `node ${VM_SEND_PATH} ${textB64} ${flag}`
  );
  const parsed = parseCdpResult(out);
  if (!parsed?.ok) {
    throw new Error(`CDP send failed: ${(parsed?.error || out).slice(0, 240)}`);
  }
}

async function orgoSendChatViaXdotool(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const spot = newChat ? { x: 720, y: 400 } : { x: 720, y: 650 };
  const openNew = newChat
    ? `xdotool key --clearmodifiers ctrl+shift+o
sleep 0.6
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
xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Meta_L Meta_R 2>/dev/null || true
${openNew}xdotool mousemove ${spot.x} ${spot.y} click 1
sleep 0.15
xdotool key --clearmodifiers ctrl+a
xdotool key --clearmodifiers ctrl+v
sleep 0.35
xdotool key --clearmodifiers Return
sleep 0.15
rm -f "$f"
echo SENT`
  );

  if (!/\bSENT\b/.test(out)) {
    throw new Error(`xdotool send failed: ${out.slice(0, 240)}`);
  }
}

/** Send text into ChatGPT on an Orgo desktop (CDP preferred, xdotool fallback). */
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
      summary: `Orgo CDP send ok (newChat=${newChat})`,
      detail: { method: "cdp", newChat, textLen: text.length },
    });
  } catch (cdpErr) {
    const cdpMsg = cdpErr instanceof Error ? cdpErr.message : String(cdpErr);
    logActivitySafe({
      kind: "orgo_send",
      ok: false,
      severity: "warn",
      computerId,
      summary: `Orgo CDP failed, trying xdotool: ${cdpMsg.slice(0, 120)}`,
      detail: { method: "cdp", error: cdpMsg.slice(0, 240), newChat },
    });
    try {
      await orgoSendChatViaXdotool(computerId, text, newChat);
      logActivitySafe({
        kind: "orgo_send",
        ok: true,
        severity: "warn",
        computerId,
        summary: `Orgo xdotool fallback send ok (newChat=${newChat})`,
        detail: { method: "xdotool_fallback", newChat, textLen: text.length },
      });
    } catch (xdoErr) {
      const xdoMsg = xdoErr instanceof Error ? xdoErr.message : String(xdoErr);
      logActivitySafe({
        kind: "orgo_send",
        ok: false,
        computerId,
        summary: `Orgo send failed (cdp+xdotool): ${xdoMsg.slice(0, 120)}`,
        detail: {
          method: "both_failed",
          cdpError: cdpMsg.slice(0, 240),
          xdotoolError: xdoMsg.slice(0, 240),
          newChat,
        },
      });
      throw xdoErr;
    }
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
  if (/\bSIGNED_IN\b/i.test(message)) return "signed_in";
  if (/\bNEEDS_2FA\b/i.test(message)) return "needs_2fa";
  if (/\bFAILED\b/i.test(message)) return "failed";
  if (/two[- ]factor|authenticator|totp|verification code|\b2fa\b/i.test(message)) {
    return "needs_2fa";
  }
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
    "- Prefer email + password login (NOT phone, NOT Google, NOT Apple)",
    "- If you see a phone number field or phone error, switch to email login immediately",
    "- Enter the email, continue, enter the password, continue/sign in",
    "- Handle Cloudflare/captcha if it appears (click the checkbox quickly)",
    "- If ChatGPT asks for a two-factor / authenticator / TOTP code, STOP immediately and reply exactly: NEEDS_2FA",
    "- Do not invent a code. Do not keep guessing.",
    "- Do not stop until ChatGPT is fully signed in (main chat UI visible, not the login page), unless 2FA is required",
    "- Keep trying until it works. Retry on mistakes immediately.",
    "- When fully signed in, reply with exactly: SIGNED_IN",
    "- If impossible after many attempts (and not 2FA), reply with: FAILED: <short reason>",
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
    `The two-factor / authenticator code is: ${code.trim()}`,
    "",
    "Rules:",
    "- Enter this code into the 2FA / authenticator field now",
    "- Submit / continue immediately",
    "- If the code is rejected, reply: FAILED: invalid 2fa code",
    "- When ChatGPT main chat UI is visible, reply exactly: SIGNED_IN",
    "- Do not ask for another code in prose — if another code is needed reply: NEEDS_2FA",
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
