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

/** Click at screen coordinates via Orgo (no X11 / xdotool). */
export async function orgoClick(
  computerId: string,
  x: number,
  y: number
): Promise<void> {
  await orgoAction(computerId, "/click", { x, y });
}

/** Type text via Orgo keyboard API (no clipboard needed). */
export async function orgoTypeText(computerId: string, text: string): Promise<void> {
  await orgoAction(computerId, "/type", { text });
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

/** Orgo desktops use X99 (not :0). Bash has no DISPLAY unless we set it. */
export const ORGO_DISPLAY_SETUP = `
orgo_display() {
  if [ -n "$DISPLAY" ] && [ -S "/tmp/.X11-unix/X\${DISPLAY#:}" ] 2>/dev/null; then
    return 0
  fi
  if [ -S /tmp/.X11-unix/X99 ]; then export DISPLAY=:99
  elif [ -S /tmp/.X11-unix/X0 ]; then export DISPLAY=:0
  else export DISPLAY=:99
  fi
}
orgo_display
`.trim();

export async function orgoBashDisplay(
  computerId: string,
  body: string
): Promise<string> {
  return orgoBash(computerId, `${ORGO_DISPLAY_SETUP}\n${body}`);
}

/** Put text on the VM X clipboard (Orgo bash — can hang; prefer orgoTypeText). */
export async function orgoSetClipboard(computerId: string, text: string): Promise<void> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const cmd = `
${ORGO_DISPLAY_SETUP}
timeout 5 sh -c "echo '${b64}' | base64 -d | xclip -selection clipboard 2>/dev/null || echo '${b64}' | base64 -d | xsel --clipboard --input"
`.trim();
  await orgoBash(computerId, cmd);
}

export async function orgoReadClipboard(computerId: string): Promise<string> {
  return orgoBashDisplay(
    computerId,
    `timeout 5 sh -c "xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || true"`
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

/** Local sleep (Vercel side) — use between poll attempts instead of Orgo /wait HTTP. */
export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Click ChatGPT message input (1280×720 Orgo desktop). */
export async function orgoClickChatInput(computerId: string): Promise<void> {
  await orgoClick(computerId, 640, 520);
}

/** Paste + send via Orgo native APIs — no xdotool / xclip. */
async function orgoSendPeerMessageViaKeys(
  computerId: string,
  text: string,
  mode: "ready" | "parallel_new" | "continue"
): Promise<void> {
  if (mode === "parallel_new") {
    await orgoClickChatInput(computerId);
    await orgoPressKey(computerId, "ctrl+shift+o");
    await localSleep(300);
  }
  await orgoClickChatInput(computerId);
  await localSleep(60);
  if (text.length <= 400) {
    await orgoTypeText(computerId, text);
  } else {
    try {
      await orgoSetClipboard(computerId, text);
      await orgoPressKey(computerId, "ctrl+v");
    } catch {
      await orgoTypeText(computerId, text);
    }
  }
  await localSleep(80);
  await orgoPressKey(computerId, "Return");
}

/** Focus ChatGPT, optionally open new chat, paste text, send. */
export async function orgoSendPeerMessage(
  computerId: string,
  text: string,
  mode: "ready" | "parallel_new" | "continue"
): Promise<void> {
  await orgoSendPeerMessageViaKeys(computerId, text, mode);
}

/** Prep empty ChatGPT chat for the next relay (non-blocking friendly). */
export async function orgoPrepFreshChatGptChat(computerId: string): Promise<void> {
  await orgoClickChatInput(computerId);
  await orgoPressKey(computerId, "ctrl+shift+o");
}

/** Focus ChatGPT browser window and click the message input. */
export async function orgoFocusChatGptInput(computerId: string): Promise<void> {
  await orgoClickChatInput(computerId);
}

/** Open a fresh empty ChatGPT chat for the next relay. */
export async function orgoOpenFreshChatGptChat(computerId: string): Promise<void> {
  await orgoPrepFreshChatGptChat(computerId);
}

export type OrgoRelayMode = "auto" | "direct" | "agent";

export function orgoRelayMode(): OrgoRelayMode {
  const m = (process.env.ORGO_RELAY_MODE || "direct").trim().toLowerCase();
  if (m === "direct" || m === "agent" || m === "auto") return m;
  return "direct";
}
