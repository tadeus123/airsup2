const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

export type OrgoComputerRecord = {
  id: string;
  name?: string;
  status?: string;
  instance_id?: string;
  hostname?: string;
  connection_url?: string;
  vnc_password?: string;
  url?: string;
};

function orgoApiKey(): string {
  const key = (process.env.ORGO_API_KEY || "").trim();
  if (!key) throw new Error("ORGO_API_KEY is not configured");
  return key;
}

function orgoWorkspaceId(): string {
  const id = (process.env.ORGO_WORKSPACE_ID || "").trim();
  if (!id) throw new Error("ORGO_WORKSPACE_ID is not configured");
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function orgoProvisionConfigured(): boolean {
  return Boolean(
    (process.env.ORGO_API_KEY || "").trim() &&
      (process.env.ORGO_WORKSPACE_ID || "").trim()
  );
}

async function orgoApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ORGO_API_BASE}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Orgo API ${path} failed (${res.status}): ${raw.slice(0, 240)}`);
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Orgo API ${path} returned invalid JSON`);
  }
}

export async function getOrgoComputer(computerId: string): Promise<OrgoComputerRecord> {
  return orgoApiFetch<OrgoComputerRecord>(`/computers/${computerId}`);
}

export async function startOrgoComputer(computerId: string): Promise<void> {
  await orgoApiFetch<{ success?: boolean }>(`/computers/${computerId}/start`, {
    method: "POST",
  });
}

export async function getOrgoVncPassword(computerId: string): Promise<string> {
  const data = await orgoApiFetch<{ password?: string; vnc_password?: string }>(
    `/computers/${computerId}/vnc-password`
  );
  const password = (data.password || data.vnc_password || "").trim();
  if (!password) throw new Error("Failed to fetch VNC password");
  return password;
}

/** Poll Orgo health — ~300ms when golden snapshot is warm. */
export async function waitForDesktopHealth(
  instanceId: string,
  maxMs: number
): Promise<boolean> {
  const started = Date.now();
  const url = `${ORGO_API_BASE}/api/desktops/${instanceId}/proxy/health`;
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${orgoApiKey()}` },
      });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(350);
  }
  return false;
}

/** Public Orgo desktop page for iframe embed. */
export function orgoDesktopUrl(computer: OrgoComputerRecord): string {
  const connection = (computer.connection_url || "").trim();
  if (connection) return connection;
  const instanceId = (computer.instance_id || "").trim();
  if (instanceId) return `https://www.orgo.ai/desktops/${instanceId}`;
  throw new Error("Computer has no connection details yet");
}

export async function resolveVncPassword(computer: OrgoComputerRecord): Promise<string> {
  const inline = (computer.vnc_password || "").trim();
  if (inline) return inline;
  return getOrgoVncPassword(computer.id);
}

export async function createOrgoComputerForUser(
  username: string
): Promise<OrgoComputerRecord> {
  const workspaceId = orgoWorkspaceId();
  const name = `airsup-${username}`.slice(0, 48);
  return orgoApiFetch<OrgoComputerRecord>("/computers", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name,
      ram: 4,
      cpu: 1,
      os: "linux",
    }),
  });
}

async function orgoBash(computerId: string, command: string): Promise<void> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/bash`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Orgo bash failed (${res.status}): ${raw.slice(0, 200)}`);
  }
}

/** WebSocket URL for noVNC / RFB clients. */
export function orgoVncWebSocketUrl(
  computer: OrgoComputerRecord,
  password: string
): string {
  const instanceId = (computer.instance_id || "").trim();
  if (!instanceId) throw new Error("Computer has no instance id yet");
  const token = encodeURIComponent(password);
  return `wss://www.orgo.ai/desktops/${instanceId}/ws/websockify?token=${token}`;
}

/** Open ChatGPT login in kiosk-style Chrome (best-effort). */
export async function openChromeToChatGpt(computerId: string): Promise<void> {
  const cmd = [
    "if [ -S /tmp/.X11-unix/X99 ]; then export DISPLAY=:99",
    "elif [ -S /tmp/.X11-unix/X0 ]; then export DISPLAY=:0",
    "else export DISPLAY=:99",
    "fi",
    "pkill -f chrome 2>/dev/null || true",
    "sleep 1",
    "(google-chrome --app=https://chatgpt.com/auth/login --window-size=1280,800 --window-position=0,0 --no-first-run --disable-infobars 2>/dev/null",
    "|| chromium-browser --app=https://chatgpt.com/auth/login --window-size=1280,800 --no-first-run 2>/dev/null",
    "|| google-chrome --kiosk https://chatgpt.com/auth/login 2>/dev/null",
    "|| true) &",
  ].join("\n");
  await orgoBash(computerId, cmd);
}

const STARTABLE_STATUSES = new Set(["stopped", "frozen", "suspended", "stopping"]);

/**
 * Wait until the Orgo desktop health check passes.
 * Uses Orgo's recommended fast path (instance_id + /proxy/health).
 */
export async function waitForComputerReady(
  computerId: string,
  maxMs = 55000
): Promise<OrgoComputerRecord> {
  const started = Date.now();
  let last: OrgoComputerRecord | null = null;
  let startAttempted = false;

  while (Date.now() - started < maxMs) {
    last = await getOrgoComputer(computerId);
    const status = (last.status || "").toLowerCase();
    const instanceId = (last.instance_id || "").trim();

    if (status === "error") {
      throw new Error("Orgo computer failed to start");
    }

    if (STARTABLE_STATUSES.has(status) && !startAttempted) {
      startAttempted = true;
      await startOrgoComputer(computerId).catch(() => {});
      await sleep(600);
      continue;
    }

    if (instanceId) {
      const remaining = maxMs - (Date.now() - started);
      if (remaining > 0) {
        const healthBudget = Math.min(remaining, 10_000);
        const healthy = await waitForDesktopHealth(instanceId, healthBudget);
        if (healthy) return last;
      }
      if (status === "running" || status === "starting" || status === "creating") {
        return last;
      }
      break;
    }

    await sleep(400);
  }

  const status = last?.status || "unknown";
  throw new Error(`Computer is still starting (${status})`);
}

export type OrgoDesktopSession = {
  computer: OrgoComputerRecord;
  desktopUrl: string;
  vncUrl: string;
  password: string;
};

/** Resolve a connectable desktop session (iframe URL + VNC fallback). */
export async function resolveOrgoDesktopSession(
  computerId: string,
  opts?: { waitMs?: number; launchChrome?: boolean }
): Promise<OrgoDesktopSession> {
  const computer = await waitForComputerReady(computerId, opts?.waitMs ?? 55000);
  const password = await resolveVncPassword(computer);
  const desktopUrl = orgoDesktopUrl(computer);
  const vncUrl = orgoVncWebSocketUrl(computer, password);

  if (opts?.launchChrome) {
    void openChromeToChatGpt(computerId).catch(() => {});
  }

  return { computer, desktopUrl, vncUrl, password };
}

/** @deprecated Use waitForComputerReady */
export async function waitForComputerRunning(
  computerId: string,
  maxMs = 90000
): Promise<OrgoComputerRecord> {
  return waitForComputerReady(computerId, maxMs);
}

export function orgoVncHostname(computer: OrgoComputerRecord): string {
  const instanceId = (computer.instance_id || "").trim();
  if (instanceId) return `www.orgo.ai/desktops/${instanceId}/ws`;
  throw new Error("Computer has no connection details yet");
}
