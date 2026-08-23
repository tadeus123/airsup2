const ORGO_API_BASE = (
  process.env.ORGO_API_BASE_URL || "https://www.orgo.ai"
).replace(/\/$/, "");

export type OrgoComputerRecord = {
  id: string;
  name: string;
  workspace_id?: string;
  status?: string;
  url?: string;
  connection_url?: string;
  instance_id?: string;
  created_at?: string;
};

function orgoApiKey(): string {
  const key = (process.env.ORGO_API_KEY || "").trim();
  if (!key) throw new Error("ORGO_API_KEY is not configured on the server");
  return key;
}

function orgoWorkspaceId(): string {
  const id = (process.env.ORGO_WORKSPACE_ID || "").trim();
  if (!id) {
    throw new Error(
      "ORGO_WORKSPACE_ID is not configured — set it in Vercel env (from orgo.ai/workspaces)"
    );
  }
  return id;
}

async function orgoFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${ORGO_API_BASE}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${orgoApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const raw = await res.text();
  let json: unknown = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = { raw };
    }
  }
  if (!res.ok) {
    const err =
      json &&
      typeof json === "object" &&
      "error" in json &&
      String((json as { error: string }).error)
        ? String((json as { error: string }).error)
        : raw.slice(0, 240) || `Orgo ${path} failed (${res.status})`;
    throw new Error(err);
  }
  return json as T;
}

export async function getOrgoComputer(computerId: string): Promise<OrgoComputerRecord> {
  return orgoFetch<OrgoComputerRecord>(`/computers/${computerId}`, { method: "GET" });
}

export async function createOrgoComputerForUser(input: {
  username: string;
  displayName?: string;
}): Promise<OrgoComputerRecord> {
  const workspaceId = orgoWorkspaceId();
  const safeName = input.username.replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
  const name = `airsup-${safeName}-${Date.now().toString(36).slice(-4)}`;

  return orgoFetch<OrgoComputerRecord>("/computers", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name,
      os: "linux",
      ram: 4,
      cpu: 1,
      resolution: "1280x720x24",
    }),
  });
}

export function orgoProvisionEnabled(): boolean {
  return Boolean(
    (process.env.ORGO_API_KEY || "").trim() &&
      (process.env.ORGO_WORKSPACE_ID || "").trim()
  );
}
