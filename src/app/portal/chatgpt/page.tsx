"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PORTAL_TOKEN_STORAGE_KEY } from "@/lib/portal-constants";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PortalChatGptPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingText, setLoadingText] = useState("starting…");
  const [desktop, setDesktop] = useState<DesktopSession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const saved = window.sessionStorage.getItem(PORTAL_TOKEN_STORAGE_KEY)?.trim();
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (saved) headers.authorization = `Bearer ${saved}`;

        if (!cancelled) setLoadingText("creating your private session…");
        const startRes = await fetch("/api/portal/start", {
          method: "POST",
          headers,
        });
        const startJson = (await startRes.json().catch(() => ({}))) as {
          ok?: boolean;
          token?: string;
          error?: string;
          message?: string;
        };

        if (!startRes.ok || !startJson.token) {
          throw new Error(
            startJson.message || startJson.error || "could not start session"
          );
        }

        window.sessionStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, startJson.token);
        const authHeaders = { authorization: `Bearer ${startJson.token}` };

        if (!cancelled) setLoadingText("opening chatgpt…");

        for (let attempt = 0; attempt < 40; attempt++) {
          const launch = attempt === 0 ? "?launch=1" : "";
          const deskRes = await fetch(`/api/portal/desktop${launch}`, {
            headers: authHeaders,
          });
          const deskJson = (await deskRes.json().catch(() => ({}))) as {
            ok?: boolean;
            vncUrl?: string;
            password?: string;
            error?: string;
            message?: string;
          };

          if (deskRes.ok && deskJson.vncUrl && deskJson.password) {
            if (!cancelled) {
              setDesktop({ vncUrl: deskJson.vncUrl, password: deskJson.password });
              setPhase("login");
            }
            return;
          }

          if (deskRes.status !== 404 && deskRes.status !== 503) {
            throw new Error(
              deskJson.message || deskJson.error || "could not open chatgpt"
            );
          }

          await sleep(2500);
        }

        throw new Error("chatgpt took too long to open — try again");
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
