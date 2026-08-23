"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PORTAL_TOKEN_STORAGE_KEY } from "@/lib/portal-constants";

const PortalDesktop = dynamic(() => import("./PortalDesktop"), {
  ssr: false,
  loading: () => (
    <div className="portal-desktop-frame portal-desktop-loading">
      <p className="portal-muted">connecting to your workspace…</p>
    </div>
  ),
});

type SessionUser = {
  username: string;
  displayName: string;
  orgoComputerId: string | null;
};

type DesktopCreds = {
  desktopUrl: string;
  status: string;
};

type Phase = "token" | "loading" | "desktop" | "error";

async function apiJson<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export default function PortalSetupPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingText, setLoadingText] = useState("checking your session…");
  const [tokenInput, setTokenInput] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [desktop, setDesktop] = useState<DesktopCreds | null>(null);
  const [error, setError] = useState("");

  const ensureWorkspace = useCallback(async (token: string) => {
    setPhase("loading");
    setError("");

    setLoadingText("validating your token…");
    const session = await apiJson<{
      ok?: boolean;
      user?: SessionUser;
      hasOrgo?: boolean;
      error?: string;
    }>("/api/portal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!session.ok || !session.data.user) {
      window.sessionStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
      throw new Error(session.data.error || "invalid token — check your airsup signup token");
    }

    window.sessionStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, token);
    setUser(session.data.user);

    const authHeaders = { authorization: `Bearer ${token}` };

    if (!session.data.hasOrgo) {
      setLoadingText("preparing your space…");
      const provision = await apiJson<{
        ok?: boolean;
        orgoComputerId?: string;
        error?: string;
        message?: string;
      }>("/api/portal/orgo", { method: "POST", headers: authHeaders });

      if (!provision.ok) {
        const msg =
          provision.data.message ||
          provision.data.error ||
          "could not prepare your workspace";
        throw new Error(msg);
      }
    }

    setLoadingText("opening your workspace…");
    const desktopRes = await apiJson<{
      ok?: boolean;
      desktopUrl?: string;
      status?: string;
      error?: string;
      message?: string;
    }>("/api/portal/desktop", { headers: authHeaders });

    if (!desktopRes.ok || !desktopRes.data.desktopUrl) {
      const msg =
        desktopRes.data.message ||
        desktopRes.data.error ||
        "could not connect to your workspace";
      throw new Error(msg);
    }

    setDesktop({
      desktopUrl: desktopRes.data.desktopUrl,
      status: desktopRes.data.status || "running",
    });
    setPhase("desktop");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = window.sessionStorage.getItem(PORTAL_TOKEN_STORAGE_KEY)?.trim();
      if (!saved) {
        if (!cancelled) setPhase("token");
        return;
      }
      try {
        await ensureWorkspace(saved);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureWorkspace]);

  async function onTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = tokenInput.trim();
    if (!token) return;
    setError("");
    try {
      await ensureWorkspace(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function useDifferentToken() {
    window.sessionStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
    setTokenInput("");
    setUser(null);
    setDesktop(null);
    setError("");
    setPhase("token");
  }

  return (
    <main className="portal-setup">
      <header className="portal-setup-header">
        <Link href="/portal" className="portal-back">
          ← portal
        </Link>
      </header>

      {phase === "token" ? (
        <section className="portal-setup-panel">
          <h1 className="portal-headline">connect your account</h1>
          <p className="portal-lead">
            paste the token from your{" "}
            <Link href="/airsup">airsup signup</Link>. it starts with{" "}
            <code className="portal-code">asp_</code>.
          </p>
          <form className="portal-token-form" onSubmit={(e) => void onTokenSubmit(e)}>
            <label htmlFor="portal-token" className="portal-sr-only">
              airsup token
            </label>
            <textarea
              id="portal-token"
              className="portal-token-input"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="asp_…"
              spellCheck={false}
              autoComplete="off"
              rows={3}
            />
            <button type="submit" className="portal-primary-btn" disabled={!tokenInput.trim()}>
              continue
            </button>
          </form>
          {error ? <p className="portal-error">{error}</p> : null}
        </section>
      ) : null}

      {phase === "loading" ? (
        <section className="portal-setup-panel portal-setup-loading">
          <p className="portal-loading-text">{loadingText}</p>
        </section>
      ) : null}

      {phase === "error" ? (
        <section className="portal-setup-panel">
          <h1 className="portal-headline">something went wrong</h1>
          <p className="portal-error">{error}</p>
          <div className="portal-setup-actions">
            <button type="button" className="portal-primary-btn" onClick={useDifferentToken}>
              try another token
            </button>
          </div>
        </section>
      ) : null}

      {phase === "desktop" && desktop ? (
        <section className="portal-workspace">
          <div className="portal-workspace-intro">
            <h1 className="portal-headline">log into chatgpt</h1>
            <p className="portal-lead">
              {user?.displayName ? (
                <>
                  this is <strong>{user.displayName}</strong>&apos;s workspace — sign in with
                  your chatgpt account below.
                </>
              ) : (
                <>this is your workspace — sign in with your chatgpt account below.</>
              )}
            </p>
          </div>
          <PortalDesktop desktopUrl={desktop.desktopUrl} />
          <p className="portal-workspace-note portal-muted">
            your password stays inside this desktop. airsup never sees it.
          </p>
          <button type="button" className="portal-text-btn" onClick={useDifferentToken}>
            use a different token
          </button>
        </section>
      ) : null}
    </main>
  );
}
