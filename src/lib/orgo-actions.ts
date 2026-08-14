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

export async function orgoWait(computerId: string, seconds: number): Promise<void> {
  const s = Math.max(0.1, Math.min(seconds, 60));
  await orgoAction(computerId, "/wait", { seconds: s });
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

/** Put text on the VM clipboard (faster than /type for long messages). */
export async function orgoSetClipboard(computerId: string, text: string): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const cmd = `echo '${b64}' | base64 -d | xclip -selection clipboard 2>/dev/null || echo '${b64}' | base64 -d | xsel --clipboard --input`;
  await orgoBash(computerId, cmd);
}

export async function orgoReadClipboard(computerId: string): Promise<string> {
  return orgoBash(
    computerId,
    "xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || true"
  );
}

/** Screenshot as base64 PNG (for stability polling). */
export async function orgoScreenshotB64(computerId: string): Promise<string> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/screenshot`, {
    headers: authHeaders(),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo screenshot failed (${res.status}): ${raw.slice(0, 120)}`);
  }
  try {
    const json = JSON.parse(raw) as { image?: string; screenshot?: string; data?: string };
    return (json.image ?? json.screenshot ?? json.data ?? raw).trim();
  } catch {
    return raw.trim();
  }
}

/** Focus ChatGPT browser window and click the message input. */
export async function orgoFocusChatGptInput(computerId: string): Promise<void> {
  const script = `
command -v xdotool >/dev/null || exit 0
W=$(xdotool search --class "chrome" 2>/dev/null | head -1)
[ -z "$W" ] && W=$(xdotool search --class "Chromium" 2>/dev/null | head -1)
[ -z "$W" ] && W=$(xdotool getactivewindow 2>/dev/null || true)
[ -n "$W" ] || exit 0
xdotool windowfocus "$W"
sleep 0.08
xdotool mousemove --window "$W" 640 520 click 1
`.trim();
  await orgoBash(computerId, script);
}

/** Open a fresh empty ChatGPT chat for the next relay. */
export async function orgoOpenFreshChatGptChat(computerId: string): Promise<void> {
  await orgoPressKey(computerId, "ctrl+shift+o");
  await orgoWait(computerId, 0.35);
}

export type OrgoRelayMode = "auto" | "direct" | "agent";

export function orgoRelayMode(): OrgoRelayMode {
  const m = (process.env.ORGO_RELAY_MODE || "direct").trim().toLowerCase();
  if (m === "direct" || m === "agent" || m === "auto") return m;
  return "direct";
}
