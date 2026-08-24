"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { BrandNav } from "@/components/BrandNav";
import { SiteFooter } from "@/components/SiteFooter";
import {
  fetchPortalDesktop,
  fetchPortalLoginStatus,
  savePortalToken,
  startPortalSession,
} from "@/lib/portal-client";
import ChatGptNativeLoginForm from "@/components/oauth/ChatGptNativeLoginForm";

const ChatGptLoginFrame = dynamic(() => import("@/components/oauth/ChatGptLoginFrame"), {
  ssr: false,
  loading: () => (
    <div className="oauth-vnc oauth-vnc--loading" aria-hidden="true">
      <span className="co-pulse" />
    </div>
  ),
});

type Phase = "loading" | "login" | "ready" | "error";

export default function OauthSetupPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [displayName, setDisplayName] = useState("");
  const [aspToken, setAspToken] = useState("");
  const [error, setError] = useState("");
  const [desktop, setDesktop] = useState<{ vncUrl: string; password: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [status, setStatus] = useState("Setting up…");

  const refreshLogin = useCallback(async (token: string) => {
    const { loggedIn: ok } = await fetchPortalLoginStatus(token);
    setLoggedIn(ok);
    return ok;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetch("/api/oauth/setup");
        const mj = (await me.json()) as {
          username?: string;
          displayName?: string;
          hasOrgo?: boolean;
          loggedIn?: boolean;
          aspToken?: string;
          error?: string;
        };
        if (!me.ok || !mj.aspToken) throw new Error(mj.error || "setup session missing");
        if (cancelled) return;

        setAspToken(mj.aspToken);
        savePortalToken(mj.aspToken);
        setDisplayName(mj.displayName || mj.username || "");
        setLoggedIn(Boolean(mj.loggedIn));

        if (mj.loggedIn) {
          setPhase("ready");
          return;
        }

        setStatus("Starting desktop…");
        if (!mj.hasOrgo) {
          await startPortalSession(mj.aspToken);
        }
        if (cancelled) return;

        setStatus("Opening ChatGPT…");
        const desk = await fetchPortalDesktop(mj.aspToken, {
          launch: true,
          waitMs: 25000,
        });
        if (cancelled) return;
        setDesktop({ vncUrl: desk.vncUrl, password: desk.password });
        setPhase("login");
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
  }, []);

  useEffect(() => {
    if (!aspToken || (phase !== "login" && phase !== "ready")) return;
    void refreshLogin(aspToken);
    const id = window.setInterval(() => {
      void refreshLogin(aspToken);
    }, 4000);
    return () => window.clearInterval(id);
  }, [aspToken, phase, refreshLogin]);

  async function finish() {
    if (!loggedIn) {
      setError("Sign into ChatGPT first");
      return;
    }
    setFinishing(true);
    setError("");
    try {
      const res = await fetch("/api/oauth/setup", { method: "POST" });
      const json = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !json.redirect) throw new Error(json.error || "could not finish");
      window.location.href = json.redirect;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFinishing(false);
    }
  }

  const canFinish = loggedIn && !finishing;

  return (
    <div className="co-page oauth-page">
      <BrandNav />
      <main className="oauth-main">
        {phase === "loading" ? (
          <section className="oauth-stage co-form-card co-form-card--enter">
            <h1>{status}</h1>
            <span className="co-pulse" aria-hidden="true" />
          </section>
        ) : null}

        {phase === "error" ? (
          <section className="oauth-stage co-form-card">
            <h1>Setup failed</h1>
            <p className="ainet-note err">{error}</p>
            <p className="ainet-muted oauth-hint">Reconnect the plugin in ChatGPT to try again.</p>
          </section>
        ) : null}

        {phase === "login" && desktop ? (
          <section className="oauth-stage oauth-stage--wide">
            <div className="oauth-copy co-form-card co-form-card--enter">
              <h1>Sign into ChatGPT</h1>
              {displayName ? <p className="oauth-name">{displayName}</p> : null}
              <ChatGptNativeLoginForm
                onSigning={setSigning}
                onSignedIn={() => {
                  setLoggedIn(true);
                  if (aspToken) void refreshLogin(aspToken);
                }}
              />
              {error ? <p className="ainet-note err">{error}</p> : null}
              <button
                type="button"
                className="co-go co-go--wide"
                disabled={!canFinish}
                onClick={() => void finish()}
              >
                {finishing ? "…" : loggedIn ? "Continue" : "Sign in to continue"}
              </button>
            </div>
            <div className={`oauth-vnc-wrap${signing ? " oauth-vnc-wrap--busy" : ""}`}>
              <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            </div>
          </section>
        ) : null}

        {phase === "ready" ? (
          <section className="oauth-stage co-form-card co-form-card--enter">
            <h1>Ready</h1>
            {displayName ? <p className="oauth-name">{displayName}</p> : null}
            {error ? <p className="ainet-note err">{error}</p> : null}
            <button
              type="button"
              className="co-go co-go--wide"
              disabled={!canFinish}
              onClick={() => void finish()}
            >
              {finishing ? "…" : "Continue to ChatGPT"}
            </button>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
