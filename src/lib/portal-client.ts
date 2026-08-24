import { PORTAL_TOKEN_STORAGE_KEY } from "@/lib/portal-constants";

export type PortalStartResult = {
  token: string;
  orgoComputerId?: string;
  provisioned?: boolean;
  status?: string;
};

export type PortalDesktopResult = {
  desktopUrl: string;
  vncUrl: string;
  password: string;
  status?: string;
};

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function getSavedPortalToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(PORTAL_TOKEN_STORAGE_KEY)?.trim() || "";
}

export function savePortalToken(token: string): void {
  window.sessionStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, token.trim());
}

export async function startPortalSession(
  existingToken?: string
): Promise<PortalStartResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const saved = (existingToken || getSavedPortalToken()).trim();
  if (saved) headers.authorization = `Bearer ${saved}`;

  const res = await fetch("/api/portal/start", { method: "POST", headers });
  const json = (await res.json().catch(() => ({}))) as PortalStartResult & {
    error?: string;
    message?: string;
  };

  if (!res.ok || !json.token) {
    throw new Error(json.message || json.error || "could not start session");
  }

  savePortalToken(json.token);
  return json;
}

export async function fetchPortalDesktop(
  token: string,
  opts?: { launch?: boolean; waitMs?: number; signal?: AbortSignal }
): Promise<PortalDesktopResult> {
  const params = new URLSearchParams();
  params.set("wait", "1");
  if (opts?.launch) params.set("launch", "1");
  if (opts?.waitMs) params.set("waitMs", String(opts.waitMs));

  const res = await fetch(`/api/portal/desktop?${params}`, {
    headers: authHeaders(token),
    signal: opts?.signal,
  });
  const json = (await res.json().catch(() => ({}))) as PortalDesktopResult & {
    error?: string;
    message?: string;
  };

  if (!res.ok || !json.vncUrl || !json.password) {
    throw new Error(json.message || json.error || "could not open chatgpt");
  }

  return json;
}

export async function fetchPortalLoginStatus(
  token: string
): Promise<{ loggedIn: boolean }> {
  const res = await fetch("/api/portal/login", {
    headers: authHeaders(token),
  });
  const json = (await res.json().catch(() => ({}))) as { loggedIn?: boolean };
  return { loggedIn: Boolean(json.loggedIn) };
}

export async function submitPortalLogin(
  token: string,
  email: string,
  password: string
): Promise<void> {
  const res = await fetch("/api/portal/login", {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.message || json.error || "could not sign in");
  }
}
