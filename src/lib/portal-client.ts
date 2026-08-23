import { PORTAL_TOKEN_STORAGE_KEY } from "@/lib/portal-constants";

export type PortalStartResult = {
  token: string;
  orgoComputerId?: string;
  provisioned?: boolean;
  status?: string;
};

export type PortalDesktopResult = {
  vncUrl: string;
  password: string;
  status?: string;
};

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Read saved portal token from session storage. */
export function getSavedPortalToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(PORTAL_TOKEN_STORAGE_KEY)?.trim() || "";
}

/** Save portal token to session storage. */
export function savePortalToken(token: string): void {
  window.sessionStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, token.trim());
}

/**
 * Start or resume a portal session and kick off VM provisioning.
 * Safe to call multiple times — idempotent for returning users.
 */
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

/**
 * Wait on the server for the desktop to become ready, then return VNC credentials.
 * One long request replaces dozens of client polls.
 */
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

const NOVNC_MODULE =
  "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js";

let novncPreload: Promise<unknown> | null = null;

/** Preload noVNC while the user is still on the portal landing. */
export function preloadNovnc(): void {
  if (typeof window === "undefined" || novncPreload) return;
  novncPreload = import(/* webpackIgnore: true */ NOVNC_MODULE).catch(() => {
    novncPreload = null;
  });
}

export function getNovncModuleUrl(): string {
  return NOVNC_MODULE;
}
