import { decodePngRgba, findChatGptSendButton } from "./orgo-send-button";

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

export async function orgoTypeText(computerId: string, text: string): Promise<void> {
  // delay:0 — Orgo otherwise types one keystroke at a time, like a human.
  await orgoAction(computerId, "/type", { text, delay: 0 });
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

/** ChatGPT’s own shortcut — focuses the composer from anywhere on the page. */
export async function orgoFocusComposer(computerId: string): Promise<void> {
  await orgoPressKey(computerId, "shift+Escape");
  await localSleep(120);
  // Tap unmodified keys so leftover Shift does not turn Enter into a newline.
  await orgoPressKey(computerId, "Escape");
  await localSleep(60);
  await orgoPressKey(computerId, "End");
}

async function orgoScreenshotPng(computerId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/screenshot`, {
      headers: authHeaders(),
    });
    const json = (await res.json()) as { image?: string };
    const image = json.image;
    if (!image) return null;
    const url = image.startsWith("http")
      ? image
      : `${ORGO_API_BASE}${image.startsWith("/") ? "" : "/"}${image}`;
    const img = await fetch(url, { headers: authHeaders() });
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch {
    return null;
  }
}

/** If Enter did not send, the blue/white send control is still on screen — click it. */
async function orgoClickSendIfStillArmed(computerId: string): Promise<boolean> {
  const buf = await orgoScreenshotPng(computerId);
  if (!buf) return false;
  const img = decodePngRgba(buf);
  if (!img) return false;
  const btn = findChatGptSendButton(img);
  if (!btn) return false;
  await orgoClick(computerId, btn.x, btn.y);
  return true;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function composerHasOnly(expected: string, got: string): boolean {
  const want = norm(expected);
  const have = norm(got);
  if (!have) return false;
  const inbound = have.match(/@airsup inbound/gi)?.length ?? 0;
  if (inbound > 1) return false;
  if (have.includes(want)) return true;
  const id = /after_message_id=(\d+)/.exec(want)?.[1];
  return Boolean(id && have.includes(`after_message_id=${id}`) && have.includes("@airsup inbound"));
}

async function orgoReadComposer(computerId: string): Promise<string> {
  await orgoPressKey(computerId, "ctrl+a");
  await localSleep(80);
  await orgoPressKey(computerId, "ctrl+c");
  await localSleep(120);
  return orgoReadClipboard(computerId);
}

async function orgoReplaceComposer(computerId: string, text: string): Promise<void> {
  await orgoSetClipboard(computerId, text);
  await orgoPressKey(computerId, "ctrl+a");
  await localSleep(80);
  await orgoPressKey(computerId, "ctrl+v");
  await localSleep(250);
}

async function orgoPasteVerified(computerId: string, text: string): Promise<void> {
  await orgoFocusComposer(computerId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await orgoReplaceComposer(computerId, text);
    const got = await orgoReadComposer(computerId);
    if (composerHasOnly(text, got)) {
      await orgoSetClipboard(computerId, text);
      await orgoPressKey(computerId, "End");
      return;
    }
  }
  await orgoSetClipboard(computerId, text);
  await orgoFocusComposer(computerId);
  await orgoReplaceComposer(computerId, text);
}

async function orgoSubmitComposer(computerId: string, sentText: string): Promise<void> {
  await orgoPressKey(computerId, "End");
  await localSleep(80);
  for (let i = 0; i < 10; i += 1) {
    await orgoPressKey(computerId, "Enter");
    await localSleep(160);
  }
  const leftover = await orgoReadComposer(computerId).catch(() => "");
  if (leftover && composerHasOnly(sentText, leftover)) {
    await orgoClickSendIfStillArmed(computerId).catch(() => false);
    for (let i = 0; i < 5; i += 1) {
      await orgoPressKey(computerId, "Enter");
      await localSleep(160);
    }
  }
}

/** New chat → replace composer contents (don't append) → verify → spam Enter. */
export async function orgoSendChat(
  computerId: string,
  text: string,
  newChat: boolean
): Promise<void> {
  try {
    if (newChat) {
      await orgoPressKey(computerId, "Escape");
      await orgoPressKey(computerId, "Escape");
      await orgoPressKey(computerId, "ctrl+shift+o");
      await localSleep(900);
    }
    await orgoPasteVerified(computerId, text);
  } catch (err) {
    console.warn("[orgo] clipboard send failed, typing with delay 0", err);
    await orgoFocusComposer(computerId);
    await orgoPressKey(computerId, "ctrl+a");
    await orgoTypeText(computerId, text);
    await localSleep(250);
  }
  await orgoSubmitComposer(computerId, text);
}

export function localSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
