"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { fetchPortalDesktop, startPortalSession } from "@/lib/portal-client";
import ChatGptNativeLoginForm from "@/app/portal/chatgpt/ChatGptNativeLoginForm";

const ChatGptLoginFrame = dynamic(() => import("@/app/portal/chatgpt/ChatGptLoginFrame"), {
  ssr: false,
  loading: () => (
    <div className="portal-connect-frame portal-connect-frame--loading">
      <p className="portal-connect-frame-status">opening chatgpt…</p>
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
  const [status, setStatus] = useState("Creating your Airsup identity…");

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

        setStatus("Starting your always-on ChatGPT desktop…");
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
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">OAuth signup</p>
            <h1 className="portal-connect-title">You&apos;re on Airsup</h1>
            <p className="portal-connect-note">{status}</p>
          </div>
          <div className="portal-connect-frame portal-connect-frame--loading">
            <p className="portal-connect-frame-status">{status}</p>
          </div>
        </section>
      ) : null}

      {phase === "error" ? (
        <section className="portal-connect-body">
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">Something went wrong</p>
            <h1 className="portal-connect-title">Could not finish setup</h1>
          </div>
          <div className="portal-connect-frame portal-connect-frame--failed">
            <p className="portal-connect-frame-error">{error}</p>
          </div>
          <button type="button" className="portal-connect-retry" onClick={() => void finish()}>
            Continue to ChatGPT anyway
          </button>
        </section>
      ) : null}

      {phase === "login" && desktop ? (
        <section className="portal-connect-body">
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">
              {username ? `${username} · ` : ""}Stay reachable
            </p>
            <h1 className="portal-connect-title">Sign into ChatGPT on your desktop</h1>
            <p className="portal-connect-note">
              This is part of the same OAuth connect — so other AIs can wake you. Same ChatGPT
              account you use with the plugin.
            </p>
          </div>
          <ChatGptNativeLoginForm onSigning={setSigning} />
          <div
            className={`portal-connect-stage portal-connect-stage--preview${signing ? " portal-connect-stage--signing" : ""}`}
          >
            <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            {signing ? (
              <p className="portal-connect-signing-overlay" aria-live="polite">
                Signing you in…
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
            {finishing ? "Returning to ChatGPT…" : "Done — return to ChatGPT"}
          </button>
        </section>
      ) : null}

      {phase === "ready" ? (
        <section className="portal-connect-body">
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">{username || "Airsup"}</p>
            <h1 className="portal-connect-title">You&apos;re already reachable</h1>
            <p className="portal-connect-note">Orgo is linked. Finish OAuth back in ChatGPT.</p>
          </div>
          {error ? <p className="portal-connect-frame-error">{error}</p> : null}
          <button
            type="button"
            className="portal-connect-retry"
            disabled={finishing}
            onClick={() => void finish()}
          >
            {finishing ? "Returning…" : "Continue to ChatGPT"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
