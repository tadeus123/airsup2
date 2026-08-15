import { readFileSync } from "fs";
import { join } from "path";

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
  } catch (cdpErr) {
    console.warn(
      "[orgo] CDP send failed, falling back to xdotool:",
      cdpErr instanceof Error ? cdpErr.message : cdpErr
    );
    await orgoSendChatViaXdotool(computerId, text, newChat);
  }
}

export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
