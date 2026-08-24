"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { fetchPortalDesktop, startPortalSession } from "@/lib/portal-client";
import ChatGptNativeLoginForm from "@/app/portal/chatgpt/ChatGptNativeLoginForm";

const ChatGptLoginFrame = dynamic(() => import("@/app/portal/chatgpt/ChatGptLoginFrame"), {
  ssr: false,
  loading: () => (
    <div className="portal-connect-frame portal-connect-frame--loading">
      <p className="portal-connect-frame-status">…</p>
    </div>
  ),
});

type Phase = "loading" | "login" | "ready" | "error";

export default function OauthSetupPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [desktop, setDesktop] = useState<{ vncUrl: string; password: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [status, setStatus] = useState("Setting up…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetch("/api/oauth/setup");
        const mj = (await me.json()) as {
          username?: string;
          hasOrgo?: boolean;
          aspToken?: string;
          error?: string;
        };
        if (!me.ok || !mj.aspToken) throw new Error(mj.error || "setup session missing");
        if (cancelled) return;
        setUsername(mj.username || "");

        if (mj.hasOrgo) {
          setPhase("ready");
          return;
        }

        setStatus("Starting desktop…");
        const started = await startPortalSession(mj.aspToken);
        if (cancelled) return;

        setStatus("Opening ChatGPT…");
        const desk = await fetchPortalDesktop(started.token, {
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

  async function finish() {
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

  return (
    <main className="portal-connect">
      <div className="portal-gate-light" aria-hidden="true" />
      <div className="portal-gate-vignette" aria-hidden="true" />

      <header className="portal-connect-header">
        <span className="as-mark" style={{ textDecoration: "none" }}>
          AIRSUP
        </span>
      </header>

      {phase === "loading" ? (
        <section className="portal-connect-body">
          <h1 className="portal-connect-title">{status}</h1>
          <div className="portal-connect-frame portal-connect-frame--loading" aria-hidden="true" />
        </section>
      ) : null}

      {phase === "error" ? (
        <section className="portal-connect-body">
          <h1 className="portal-connect-title">Setup failed</h1>
          <div className="portal-connect-frame portal-connect-frame--failed">
            <p className="portal-connect-frame-error">{error}</p>
          </div>
          <button type="button" className="portal-connect-retry" onClick={() => void finish()}>
            Continue
          </button>
        </section>
      ) : null}

      {phase === "login" && desktop ? (
        <section className="portal-connect-body">
          <h1 className="portal-connect-title">Sign into ChatGPT</h1>
          <ChatGptNativeLoginForm onSigning={setSigning} />
          <div
            className={`portal-connect-stage portal-connect-stage--preview${signing ? " portal-connect-stage--signing" : ""}`}
          >
            <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            {signing ? (
              <p className="portal-connect-signing-overlay" aria-live="polite">
                …
              </p>
            ) : null}
          </div>
          {error ? <p className="portal-connect-frame-error">{error}</p> : null}
          <button
            type="button"
            className="portal-connect-retry"
            disabled={finishing}
            onClick={() => void finish()}
          >
            {finishing ? "…" : "Done"}
          </button>
        </section>
      ) : null}

      {phase === "ready" ? (
        <section className="portal-connect-body">
          <h1 className="portal-connect-title">{username || "Ready"}</h1>
          {error ? <p className="portal-connect-frame-error">{error}</p> : null}
          <button
            type="button"
            className="portal-connect-retry"
            disabled={finishing}
            onClick={() => void finish()}
          >
            {finishing ? "…" : "Continue"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
