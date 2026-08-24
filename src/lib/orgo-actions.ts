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

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${orgoApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function orgoAction<T>(
  computerId: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo ${path} failed (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return { raw } as T;
  }
}

export async function orgoPressKey(computerId: string, key: string): Promise<void> {
  await orgoAction(computerId, "/key", { key });
}

export async function orgoClick(
  computerId: string,
  x: number,
  y: number
): Promise<void> {
  await orgoAction(computerId, "/click", { x, y });
}

export async function orgoType(computerId: string, text: string): Promise<void> {
  await orgoAction(computerId, "/type", { text });
}

export async function orgoBash(computerId: string, command: string): Promise<string> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/bash`, {
    method: "POST",
    headers: authHeaders(),
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

/** Orgo desktops expose X11 as :99, and bash has no DISPLAY unless we set it. */
const DISPLAY_SETUP = `
if [ -S /tmp/.X11-unix/X99 ]; then export DISPLAY=:99
elif [ -S /tmp/.X11-unix/X0 ]; then export DISPLAY=:0
else export DISPLAY=:99
fi
`.trim();

export async function orgoReadClipboard(computerId: string): Promise<string> {
  return orgoBash(
    computerId,
    `${DISPLAY_SETUP}
timeout 3 xclip -selection clipboard -o 2>/dev/null || timeout 3 xsel --clipboard --output 2>/dev/null || true`
  );
}

/**
 * Put text on the VM clipboard. Do not wrap xclip in `timeout` — it forks and
 * must stay alive to serve Ctrl+V. DISPLAY is required; Orgo bash has none.
 */
export async function orgoSetClipboard(computerId: string, text: string): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  await orgoBash(
    computerId,
    `${DISPLAY_SETUP}
f=/tmp/airsup-clip.$$
echo '${b64}' | base64 -d > "$f" || exit 1
if ! xclip -selection clipboard -i "$f" >/dev/null 2>&1; then
  timeout 2 xsel --clipboard --input < "$f" || true
fi
xclip -selection primary -i "$f" >/dev/null 2>&1 || true
rm -f "$f"
echo ok`
  );
}

const VM_SEND_PATH = "/tmp/airsup-chatgpt-send.js";
const VM_LOGIN_PATH = "/tmp/airsup-chatgpt-login.js";

function loadVmSendScript(): string {
  const candidates = [
    join(process.cwd(), "src/lib/vm/airsup-chatgpt-send.js"),
    join(process.cwd(), "scripts/airsup-chatgpt-send.js"),
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

function loadVmLoginScript(): string {
  const candidates = [
    join(process.cwd(), "scripts/airsup-chatgpt-login.js"),
    join(process.cwd(), "src/lib/vm/airsup-chatgpt-login.js"),
    join(__dirname, "vm/airsup-chatgpt-login.js"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("airsup-chatgpt-login.js missing from deployment bundle");
}

async function deployVmScript(
  computerId: string,
  path: string,
  script: string
): Promise<void> {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const out = await orgoBash(
    computerId,
    `python3 - <<'PY'
import base64, os
raw = base64.b64decode("${b64}")
open("${path}", "wb").write(raw)
os.chmod("${path}", 0o755)
print("ok", len(raw))
PY`
  );
  if (!/\bok\b/.test(out)) {
    throw new Error(`deployVmScript ${path} failed: ${out.slice(0, 200)}`);
  }
}

async function deployVmSendScript(computerId: string): Promise<void> {
  await deployVmScript(computerId, VM_SEND_PATH, loadVmSendScript());
}

async function deployVmLoginScript(computerId: string): Promise<void> {
  await deployVmScript(computerId, VM_LOGIN_PATH, loadVmLoginScript());
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

/**
 * Fill ChatGPT login via Chrome CDP on the VM (reliable DOM fill, not VNC/pixels).
 */
export async function fillChatGptLoginViaCdp(
  computerId: string,
  email: string,
  password: string
): Promise<void> {
  await deployVmLoginScript(computerId);
  const emailB64 = Buffer.from(email, "utf8").toString("base64");
  const passB64 = Buffer.from(password, "utf8").toString("base64");
  const out = await orgoBash(
    computerId,
    `node ${VM_LOGIN_PATH} ${emailB64} ${passB64}`
  );
  const start = out.lastIndexOf("{");
  const json = start >= 0 ? out.slice(start) : out;
  let parsed: { ok?: boolean; error?: string } | null = null;
  try {
    parsed = JSON.parse(json) as { ok?: boolean; error?: string };
  } catch {
    parsed = null;
  }
  if (!parsed?.ok) {
    throw new Error(
      `CDP login failed: ${(parsed?.error || out).slice(0, 240)}`
    );
  }
}

type CdpSendResult = {
  ok?: boolean;
  method?: string;
  error?: string;
  ensure?: { restarted?: boolean; seeded?: boolean };
};

function parseCdpResult(out: string): CdpSendResult | null {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as CdpSendResult;
    } catch {
      /* keep looking */
    }
  }
  const start = out.lastIndexOf("{");
  if (start >= 0) {
    try {
      return JSON.parse(out.slice(start)) as CdpSendResult;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Primary path: Chrome DevTools Protocol — set composer text + click send in the DOM.
 * Survives layout changes, focus theft, and long wake prompts.
 */
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
    throw new Error(
      `CDP send failed: ${(parsed?.error || out).slice(0, 240)}`
    );
  }
}

/** Last-resort xdotool path if CDP/Chrome is broken on the VM. */
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

/**
 * Send text into ChatGPT on an Orgo desktop.
 * Prefers CDP/DOM (reliable); falls back to xdotool only if CDP fails.
 */
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

/** Ask Orgo's computer-use agent to sign into ChatGPT with the given credentials. */
export async function signInChatGptViaOrgoAgent(
  computerId: string,
  email: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
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
    "- Do not stop until ChatGPT is fully signed in (main chat UI visible, not the login page)",
    "- Keep trying until it works. Retry on mistakes immediately.",
    "- When done, reply with exactly: SIGNED_IN",
    "- If impossible after many attempts, reply with: FAILED: <short reason>",
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
    throw new Error(
      `Orgo agent login failed (${res.status}): ${raw.slice(0, 240)}`
    );
  }

  let message = "";
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    message = (json.choices?.[0]?.message?.content || "").trim();
  } catch {
    message = raw.slice(0, 400);
  }

  const ok = /\bSIGNED_IN\b/i.test(message) && !/\bFAILED\s*:/i.test(message);
  return { ok, message };
}

export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
