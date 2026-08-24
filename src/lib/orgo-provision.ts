import {
  continueChatGptLoginWith2fa,
  getChatGptAuthState,
  localSleep,
  signInChatGptViaOrgoAgent,
  type OrgoLoginAgentResult,
} from "./orgo-actions";

export type PortalLoginResult = OrgoLoginAgentResult;

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

function normalizeOrgoComputer(data: Record<string, unknown>): OrgoComputerRecord {
  const raw = data as OrgoComputerRecord;
  const connection = (raw.connection_url || "").trim();
  let instanceId = (raw.instance_id || "").trim();
  if (!instanceId && connection) {
    const match = connection.match(/\/desktops\/([^/?#]+)/);
    if (match?.[1]) instanceId = match[1];
  }
  return {
    ...raw,
    instance_id: instanceId || raw.instance_id,
    vnc_password:
      (raw.vnc_password || (data.vncPassword as string | undefined) || "").trim() ||
      undefined,
  };
}

export async function getOrgoComputer(computerId: string): Promise<OrgoComputerRecord> {
  const data = await orgoApiFetch<Record<string, unknown>>(`/computers/${computerId}`);
  return normalizeOrgoComputer(data);
}

export async function restartOrgoComputer(computerId: string): Promise<void> {
  await orgoApiFetch<{ success?: boolean }>(`/computers/${computerId}/restart`, {
    method: "POST",
  });
}

export async function deleteOrgoComputer(computerId: string): Promise<void> {
  await orgoApiFetch<{ success?: boolean }>(`/computers/${computerId}`, {
    method: "DELETE",
  });
}

export type OrgoWorkspaceComputer = OrgoComputerRecord & {
  created_at?: string;
};

function permanentlyProtectedIds(): Set<string> {
  const keep = new Set<string>();
  const fallback = (process.env.ORGO_DEFAULT_COMPUTER_ID || "").trim();
  if (fallback) keep.add(fallback);
  const portalShared = (process.env.ORGO_PORTAL_SHARED_COMPUTER_ID || "").trim();
  if (portalShared) keep.add(portalShared);
  const raw = (process.env.ORGO_COMPUTER_MAP || "").trim();
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const id of Object.values(obj)) {
        const trimmed = (id || "").trim();
        if (trimmed) keep.add(trimmed);
      }
    } catch {
      // ignore
    }
  }
  return keep;
}

/** List computers in the configured Orgo workspace (falls back to all workspaces). */
export async function listOrgoWorkspaceComputers(): Promise<OrgoWorkspaceComputer[]> {
  const workspaceId = orgoWorkspaceId();
  const data = await orgoApiFetch<Record<string, unknown>>("/workspaces");
  const workspaces =
    (data.workspaces as Array<{
      id: string;
      desktops?: Array<Record<string, unknown>>;
      computers?: Array<Record<string, unknown>>;
    }>) ||
    (data.projects as Array<{
      id: string;
      desktops?: Array<Record<string, unknown>>;
      computers?: Array<Record<string, unknown>>;
    }>) ||
    [];

  function desktopsOf(ws: {
    desktops?: Array<Record<string, unknown>>;
    computers?: Array<Record<string, unknown>>;
  }): OrgoWorkspaceComputer[] {
    const raw = ws.desktops?.length ? ws.desktops : ws.computers || [];
    return raw.map((d) => normalizeOrgoComputer(d));
  }

  const ws = workspaces.find((w) => w.id === workspaceId);
  const primary = ws ? desktopsOf(ws) : [];
  if (primary.length > 0) return primary;

  if (ws) {
    try {
      const detail = await orgoApiFetch<{
        desktops?: Array<Record<string, unknown>>;
        computers?: Array<Record<string, unknown>>;
      }>(`/workspaces/${workspaceId}`);
      const detailed = desktopsOf(detail);
      if (detailed.length > 0) return detailed;
    } catch {
      // fall through
    }
  }

  const all: OrgoWorkspaceComputer[] = [];
  for (const workspace of workspaces) {
    all.push(...desktopsOf(workspace));
  }
  return all;
}

function portalEphemeralName(name?: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return n.startsWith("airsup-p") || n.startsWith("airsup-portal");
}

/** Protect manually provisioned computers; ephemeral portal VMs are reclaimable. */
function protectedComputerIds(
  computers: OrgoWorkspaceComputer[],
  linkedIds: Iterable<string>
): Set<string> {
  const linked = new Set([...linkedIds].map((id) => id.trim()).filter(Boolean));
  const keep = permanentlyProtectedIds();
  for (const computer of computers) {
    if (!portalEphemeralName(computer.name) && linked.has(computer.id)) {
      keep.add(computer.id);
    }
  }
  return keep;
}

/**
 * Delete stale auto-provisioned portal VMs to free Orgo capacity.
 * Only targets ephemeral portal sessions (name prefix `airsup-p`).
 */
export async function cleanupStalePortalComputers(opts?: {
  keepIds?: Iterable<string>;
  targetFree?: number;
}): Promise<{ deleted: string[]; skipped: number }> {
  const computers = await listOrgoWorkspaceComputers();
  const keep = protectedComputerIds(computers, opts?.keepIds || []);
  const targetFree = Math.max(1, opts?.targetFree ?? 1);
  const portalCandidates = computers
    .filter((c) => portalEphemeralName(c.name))
    .filter((c) => !keep.has(c.id))
    .sort((a, b) => {
      const ta = Date.parse(a.created_at || "") || 0;
      const tb = Date.parse(b.created_at || "") || 0;
      return ta - tb;
    });

  const deleted: string[] = [];
  for (const computer of portalCandidates) {
    if (deleted.length >= targetFree) break;
    try {
      await deleteOrgoComputer(computer.id);
      deleted.push(computer.id);
    } catch {
      // try next
    }
  }

  return { deleted, skipped: portalCandidates.length - deleted.length };
}

/** Claim an existing ephemeral portal VM instead of creating a new one. */
export async function claimStalePortalComputer(opts?: {
  keepIds?: Iterable<string>;
}): Promise<OrgoComputerRecord | null> {
  const computers = await listOrgoWorkspaceComputers();
  const keep = protectedComputerIds(computers, opts?.keepIds || []);
  const candidate = computers
    .filter((c) => portalEphemeralName(c.name))
    .filter((c) => !keep.has(c.id))
    .sort((a, b) => {
      const ta = Date.parse(a.created_at || "") || 0;
      const tb = Date.parse(b.created_at || "") || 0;
      return ta - tb;
    })[0];
  return candidate || null;
}

/** Last resort: delete the oldest non-protected computer to free a slot. */
export async function forceFreeOrgoSlot(opts?: {
  keepIds?: Iterable<string>;
}): Promise<string | null> {
  const computers = await listOrgoWorkspaceComputers();
  const keep = protectedComputerIds(computers, opts?.keepIds || []);
  const victim = computers
    .filter((c) => !keep.has(c.id))
    .sort((a, b) => {
      const ta = Date.parse(a.created_at || "") || 0;
      const tb = Date.parse(b.created_at || "") || 0;
      return ta - tb;
    })[0];
  if (!victim?.id) return null;
  await deleteOrgoComputer(victim.id);
  return victim.id;
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
  const data = await orgoApiFetch<Record<string, unknown>>("/computers", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name,
      ram: 4,
      cpu: 1,
      os: "linux",
    }),
  });
  return normalizeOrgoComputer(data);
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

/** Read chrome launch diagnostics from the VM (for portal debugging). */
export async function orgoBashDebug(computerId: string): Promise<string> {
  const res = await fetch(`${ORGO_API_BASE}/api/computers/${computerId}/bash`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command:
        "pgrep -af chrome | head -3; echo '---'; tail -20 /tmp/airsup-chrome.log 2>/dev/null || echo no_log",
    }),
  });
  const raw = await res.text();
  if (!res.ok) return `bash_err_${res.status}:${raw.slice(0, 120)}`;
  try {
    const json = JSON.parse(raw) as { stdout?: string; output?: string; result?: string };
    return (json.stdout ?? json.output ?? json.result ?? raw).trim().slice(0, 400);
  } catch {
    return raw.trim().slice(0, 400);
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

async function orgoWait(computerId: string, seconds: number): Promise<void> {
  const sec = Math.min(60, Math.max(0, seconds));
  await orgoApiFetch<{ success?: boolean }>(`/computers/${computerId}/wait`, {
    method: "POST",
    body: JSON.stringify({ seconds: sec }),
  });
}

/** Open ChatGPT login via Chrome on the VM desktop. */
export async function openChromeToChatGpt(
  computerId: string,
  opts?: { force?: boolean }
): Promise<void> {
  const force = opts?.force ? "1" : "0";
  const cmd = [
    "if [ -S /tmp/.X11-unix/X99 ]; then export DISPLAY=:99",
    "elif [ -S /tmp/.X11-unix/X0 ]; then export DISPLAY=:0",
    "else export DISPLAY=:99",
    "fi",
    "if [ -x /opt/google/chrome/chrome ]; then CHROME=/opt/google/chrome/chrome",
    "elif [ -x /opt/google/chrome/google-chrome ]; then CHROME=/opt/google/chrome/google-chrome",
    "else CHROME=$(command -v google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1); fi",
    "if [ -z \"$CHROME\" ]; then echo NO_CHROME; exit 1; fi",
    `FORCE=${force}`,
    'if [ "$FORCE" != "1" ] && pgrep -f "/opt/google/chrome/chrome" >/dev/null 2>&1; then echo ALREADY; exit 0; fi',
    'if [ "$FORCE" = "1" ]; then pkill -9 -f "/opt/google/chrome/chrome" 2>/dev/null || true; pkill -9 -f "google-chrome" 2>/dev/null || true; sleep 1; fi',
    "setsid env DISPLAY=\"$DISPLAY\" \"$CHROME\" --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --hide-crash-restore-bubble --disable-session-crashed-bubble --remote-debugging-port=9222 --remote-allow-origins=* --window-size=1280,720 --start-maximized 'https://chatgpt.com/auth/login' >/tmp/airsup-chrome.log 2>&1 < /dev/null &",
    "echo LAUNCHED",
  ].join("\n");
  await orgoBash(computerId, cmd);
}

/** Launch Chrome quickly — no long sleeps; form fill handles the rest. */
export async function prepareChatGptLoginOnDesktop(computerId: string): Promise<void> {
  await openChromeToChatGpt(computerId);
}

/**
 * Sign into ChatGPT via Orgo computer-use agent.
 * May return needs_2fa so the UI can collect a TOTP code and continue the thread.
 */
export async function fillChatGptLoginOnDesktop(
  computerId: string,
  email: string,
  password: string
): Promise<PortalLoginResult> {
  const already = await getChatGptAuthState(computerId);
  if (already.loggedIn) return { status: "signed_in", message: "SIGNED_IN" };

  await openChromeToChatGpt(computerId, { force: false });
  await localSleep(800);

  const agent = await signInChatGptViaOrgoAgent(computerId, email, password);
  if (agent.status === "signed_in") {
    const after = await getChatGptAuthState(computerId);
    if (after.loggedIn || /\bSIGNED_IN\b/i.test(agent.message)) {
      return { status: "signed_in", message: "SIGNED_IN", threadId: agent.threadId };
    }
  }
  return agent;
}

/** Continue after the user enters a 2FA / authenticator code. */
export async function continueChatGptLoginOnDesktop(
  computerId: string,
  threadId: string,
  code: string
): Promise<PortalLoginResult> {
  const agent = await continueChatGptLoginWith2fa(computerId, threadId, code);
  if (agent.status === "signed_in") {
    const after = await getChatGptAuthState(computerId);
    if (after.loggedIn || /\bSIGNED_IN\b/i.test(agent.message)) {
      return { status: "signed_in", message: "SIGNED_IN", threadId: agent.threadId };
    }
  }
  return agent;
}

export { getChatGptAuthState };

/** Launch ChatGPT login — await this before returning from serverless handlers. */
export async function launchChatGptLoginWithRetries(computerId: string): Promise<void> {
  try {
    await prepareChatGptLoginOnDesktop(computerId);
  } catch {
    await openChromeToChatGpt(computerId).catch(() => {});
  }
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
  let restartAttempted = false;

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

    if (!instanceId && Date.now() - started > 12_000 && !restartAttempted) {
      restartAttempted = true;
      await restartOrgoComputer(computerId).catch(() => {});
      await sleep(1500);
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
  const hasInstance = Boolean((last?.instance_id || "").trim());
  throw new Error(
    hasInstance
      ? `Computer is still starting (${status})`
      : `Computer has no desktop id yet (${status}) — Orgo may be at capacity`
  );
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
  opts?: { waitMs?: number }
): Promise<OrgoDesktopSession> {
  const computer = await waitForComputerReady(computerId, opts?.waitMs ?? 55000);
  const password = await resolveVncPassword(computer);
  const desktopUrl = orgoDesktopUrl(computer);
  const vncUrl = orgoVncWebSocketUrl(computer, password);
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
