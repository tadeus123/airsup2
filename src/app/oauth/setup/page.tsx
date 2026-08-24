"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { BrandNav } from "@/components/BrandNav";
import { fetchPortalDesktop, startPortalSession } from "@/lib/portal-client";
import ChatGptNativeLoginForm from "@/app/portal/chatgpt/ChatGptNativeLoginForm";

const ChatGptLoginFrame = dynamic(() => import("@/app/portal/chatgpt/ChatGptLoginFrame"), {
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
            <button type="button" className="co-go co-go--wide" onClick={() => void finish()}>
              Continue
            </button>
          </section>
        ) : null}

        {phase === "login" && desktop ? (
          <section className="oauth-stage oauth-stage--wide">
            <div className="oauth-copy co-form-card co-form-card--enter">
              <h1>Sign into ChatGPT</h1>
              <ChatGptNativeLoginForm onSigning={setSigning} />
              {error ? <p className="ainet-note err">{error}</p> : null}
              <button
                type="button"
                className="co-go co-go--wide"
                disabled={finishing}
                onClick={() => void finish()}
              >
                {finishing ? "…" : "Done"}
              </button>
            </div>
            <div className={`oauth-vnc-wrap${signing ? " oauth-vnc-wrap--busy" : ""}`}>
              <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            </div>
          </section>
        ) : null}

        {phase === "ready" ? (
          <section className="oauth-stage co-form-card co-form-card--enter">
            <h1>{username || "Ready"}</h1>
            {error ? <p className="ainet-note err">{error}</p> : null}
            <button
              type="button"
              className="co-go co-go--wide"
              disabled={finishing}
              onClick={() => void finish()}
            >
              {finishing ? "…" : "Continue"}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
