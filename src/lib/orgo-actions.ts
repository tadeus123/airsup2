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

/**
 * ChatGPT @ 1280×720 (sidebar open), measured on kosti2:
 * - Empty new chat: composer mid-screen, send circle ~ (1128, 394)
 * - In-thread: composer bottom, send/voice ~ (1064, 670)
 *
 * Stupid bugs we hit before:
 * - Separate Orgo /key+/click calls left focus on sidebar after Ctrl+Shift+O
 * - Send click at y=400 while in-thread composer is at y≈670 (or vice versa)
 * - PNG send-button finder ROI cut off at 0.92×height and never saw y=670
 */
const LAYOUT = {
  newChat: { composer: { x: 720, y: 400 }, send: { x: 1128, y: 394 } },
  thread: { composer: { x: 720, y: 650 }, send: { x: 1064, y: 670 } },
} as const;

/**
 * New chat (optional) → focus composer → paste → click send.
 * One bash/xdotool round-trip so modifiers/focus cannot desync between API calls.
 */
export async function orgoSendChat(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const spot = newChat ? LAYOUT.newChat : LAYOUT.thread;
  const openNew = newChat
    ? `xdotool key --clearmodifiers ctrl+shift+o
sleep 1.2
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
sleep 0.1
${openNew}xdotool mousemove ${spot.composer.x} ${spot.composer.y} click 1
sleep 0.25
xdotool key --clearmodifiers ctrl+a
sleep 0.05
xdotool key --clearmodifiers ctrl+v
sleep 0.9
xdotool mousemove ${spot.send.x} ${spot.send.y} click 1
sleep 0.25
rm -f "$f"
echo SENT`
  );

  if (!/\bSENT\b/.test(out)) {
    throw new Error(`orgoSendChat failed: ${out.slice(0, 240)}`);
  }
}

export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
