"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const trustedRef = useRef(false);
  const finishStartedRef = useRef(false);

  const refreshLogin = useCallback(async (token: string) => {
    const { loggedIn: ok } = await fetchPortalLoginStatus(token);
    if (ok) {
      setLoggedIn(true);
      return true;
    }
    // Never undo a successful form login — CDP can lag behind Orgo agent.
    if (trustedRef.current) return true;
    setLoggedIn(false);
    return false;
  }, []);

  const finish = useCallback(async () => {
    if (finishStartedRef.current) return;
    finishStartedRef.current = true;
    setFinishing(true);
    setError("");
    setStatus("Returning to ChatGPT…");
    try {
      let lastErr = "could not finish";
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch("/api/oauth/setup", { method: "POST" });
        const json = (await res.json()) as { redirect?: string; error?: string };
        if (res.ok && json.redirect) {
          window.location.href = json.redirect;
          return;
        }
        lastErr = json.error || lastErr;
        if (res.status === 401) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      throw new Error(lastErr);
    } catch (e) {
      finishStartedRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
      setFinishing(false);
    }
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

        if (mj.loggedIn) {
          setLoggedIn(true);
          trustedRef.current = true;
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

  // Once ChatGPT is signed in, automatically return to ChatGPT's OAuth modal.
  useEffect(() => {
    if (!loggedIn || finishing || phase === "loading" || phase === "error") return;
    void finish();
  }, [loggedIn, finishing, phase, finish]);

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
              <h1>{finishing ? "Returning to ChatGPT…" : "Connect ChatGPT"}</h1>
              {displayName ? <p className="oauth-name">{displayName}</p> : null}
              {!finishing ? (
                <ChatGptNativeLoginForm
                  onSigning={setSigning}
                  onSignedIn={() => {
                    trustedRef.current = true;
                    setLoggedIn(true);
                  }}
                />
              ) : (
                <p className="oauth-login-status">Signed in — finishing connection…</p>
              )}
              {error ? <p className="ainet-note err">{error}</p> : null}
              {!finishing ? (
                <button
                  type="button"
                  className="co-go co-go--wide"
                  disabled={!canFinish}
                  onClick={() => void finish()}
                >
                  {loggedIn ? "Continue to ChatGPT" : "Connect to continue"}
                </button>
              ) : (
                <span className="co-pulse" aria-hidden="true" />
              )}
            </div>
            <div className={`oauth-vnc-wrap${signing || finishing ? " oauth-vnc-wrap--busy" : ""}`}>
              <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            </div>
          </section>
        ) : null}

        {phase === "ready" ? (
          <section className="oauth-stage co-form-card co-form-card--enter">
            <h1>{finishing ? "Returning to ChatGPT…" : "Ready"}</h1>
            {displayName ? <p className="oauth-name">{displayName}</p> : null}
            {error ? <p className="ainet-note err">{error}</p> : null}
            {finishing ? (
              <span className="co-pulse" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="co-go co-go--wide"
                disabled={!canFinish}
                onClick={() => void finish()}
              >
                Continue to ChatGPT
              </button>
            )}
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
