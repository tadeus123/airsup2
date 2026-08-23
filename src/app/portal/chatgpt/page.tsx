"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchPortalDesktop,
  preloadNovnc,
  startPortalSession,
} from "@/lib/portal-client";

const ChatGptLoginFrame = dynamic(() => import("./ChatGptLoginFrame"), {
  ssr: false,
  loading: () => (
    <div className="portal-chatgpt-login-card portal-chatgpt-login-card--loading">
      <p className="portal-chatgpt-login-loading">opening chatgpt…</p>
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

    preloadNovnc();

    stageTimer = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, LOADING_STAGES.length - 1);
      if (!cancelled) setLoadingText(LOADING_STAGES[stageIndex]);
    }, 8000);

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
    <main className="portal-chatgpt-flow">
      <header className="portal-chatgpt-flow-header">
        <Link href="/portal" className="portal-back">
          ← back
        </Link>
      </header>

      {phase === "loading" ? (
        <div className="portal-chatgpt-flow-center">
          <p className="portal-loading-text">{loadingText}</p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="portal-chatgpt-flow-center">
          <h1 className="portal-headline">something went wrong</h1>
          <p className="portal-error">{error}</p>
          <button
            type="button"
            className="portal-primary-btn"
            onClick={() => window.location.reload()}
          >
            try again
          </button>
        </div>
      ) : null}

      {phase === "login" && desktop ? (
        <div className="portal-chatgpt-flow-center">
          <div className="portal-chatgpt-login-shell">
            <h1 className="portal-chatgpt-login-title">connect your chatgpt</h1>
            <ChatGptLoginFrame vncUrl={desktop.vncUrl} password={desktop.password} />
            <p className="portal-chatgpt-login-note">
              sign in below — this happens directly inside your private computer.
              airsup never sees your password.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
