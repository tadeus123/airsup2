"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPortalDesktop, startPortalSession } from "@/lib/portal-client";

const ChatGptLoginFrame = dynamic(() => import("./ChatGptLoginFrame"), {
  ssr: false,
  loading: () => (
    <div className="portal-connect-frame portal-connect-frame--loading">
      <p className="portal-connect-frame-status">opening chatgpt…</p>
    </div>
  ),
});

type DesktopSession = {
  vncUrl: string;
  password: string;
};

type Phase = "loading" | "login" | "error";

const LOADING_STAGES = [
  "connecting…",
  "starting your private computer…",
  "opening chatgpt…",
] as const;

export default function PortalChatGptPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingText, setLoadingText] = useState<string>(LOADING_STAGES[0]);
  const [desktop, setDesktop] = useState<DesktopSession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stageTimer: ReturnType<typeof setInterval> | null = null;
    let stageIndex = 0;

    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, LOADING_STAGES.length - 1);
      if (!cancelled) setLoadingText(LOADING_STAGES[stageIndex]);
    }, 6000);

    void (async () => {
      try {
        const started = await startPortalSession();
        if (cancelled) return;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 65000);

        try {
          const desk = await fetchPortalDesktop(started.token, {
            launch: true,
            waitMs: 58000,
            signal: controller.signal,
          });
          if (!cancelled) {
            setDesktop({ vncUrl: desk.vncUrl, password: desk.password });
            setPhase("login");
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof Error && e.name === "AbortError"
              ? "chatgpt took too long to open — try again"
              : e instanceof Error
                ? e.message
                : String(e);
          setError(msg);
          setPhase("error");
        }
      } finally {
        if (stageTimer) clearInterval(stageTimer);
      }
    })();

    return () => {
      cancelled = true;
      if (stageTimer) clearInterval(stageTimer);
    };
  }, []);

  return (
    <main className="portal-connect">
      <div className="portal-gate-light" aria-hidden="true" />
      <div className="portal-gate-vignette" aria-hidden="true" />

      <header className="portal-connect-header">
        <Link href="/portal" className="portal-connect-back">
          ← back
        </Link>
      </header>

      {phase === "loading" ? (
        <section className="portal-connect-body portal-connect-body--center">
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">preparing</p>
            <h1 className="portal-connect-title">your chatgpt</h1>
            <div className="portal-gate-rule" aria-hidden="true" />
          </div>
          <p className="portal-connect-loading">{loadingText}</p>
        </section>
      ) : null}

      {phase === "error" ? (
        <section className="portal-connect-body portal-connect-body--center">
          <h1 className="portal-connect-title">something went wrong</h1>
          <p className="portal-connect-error">{error}</p>
          <button
            type="button"
            className="portal-connect-retry"
            onClick={() => window.location.reload()}
          >
            try again
          </button>
        </section>
      ) : null}

      {phase === "login" && desktop ? (
        <section className="portal-connect-body">
          <div className="portal-connect-intro">
            <p className="portal-connect-eyebrow">sign in</p>
            <h1 className="portal-connect-title">your chatgpt</h1>
            <div className="portal-gate-rule" aria-hidden="true" />
          </div>
          <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
          <p className="portal-connect-note">
            inside your private computer — airsup never sees your password.
          </p>
        </section>
      ) : null}
    </main>
  );
}
