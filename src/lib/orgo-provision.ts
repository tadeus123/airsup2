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

export async function getOrgoVncPassword(computerId: string): Promise<string> {
  const data = await orgoApiFetch<{ password?: string }>(
    `/computers/${computerId}/vnc-password`
  );
  const password = (data.password || "").trim();
  if (!password) throw new Error("Failed to fetch VNC password");
  return password;
}

/** Host string for orgo-vnc: wss://{hostname}/websockify */
export function orgoVncHostname(computer: OrgoComputerRecord): string {
  const connection = (computer.connection_url || "").trim();
  if (connection) {
    const host = connection.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `${host}/ws`;
  }
  const instanceId = (computer.instance_id || "").trim();
  if (instanceId) return `www.orgo.ai/desktops/${instanceId}/ws`;
  throw new Error("Computer has no connection details yet");
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

/** Open ChatGPT in the user's cloud desktop (best-effort). */
export async function openChromeToChatGpt(computerId: string): Promise<void> {
  await orgoBash(
    computerId,
    `if [ -S /tmp/.X11-unix/X99 ]; then export DISPLAY=:99
elif [ -S /tmp/.X11-unix/X0 ]; then export DISPLAY=:0
else export DISPLAY=:99
fi
(google-chrome --new-window https://chatgpt.com 2>/dev/null || chromium-browser --new-window https://chatgpt.com 2>/dev/null || xdg-open https://chatgpt.com 2>/dev/null || true) &`
  );
}
