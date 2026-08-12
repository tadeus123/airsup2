"use client";

import { useRef, useState } from "react";

type OnboardResult = {
  username: string;
  displayName: string;
  workerPrompt: string;
  mcpUrl: string;
  plugin: { steps: string[] };
};

function cleanUsername(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function fullNameToUsername(name: string) {
  const first = name.trim().split(/\s+/)[0] || name.trim();
  return cleanUsername(first);
}

export default function SetupPage() {
  const nameRef = useRef<HTMLElement>(null);
  const workerRef = useRef<HTMLElement>(null);
  const gatewayRef = useRef<HTMLElement>(null);

  const [fullName, setFullName] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [error, setError] = useState("");

  function scrollToPanel(ref: React.RefObject<HTMLElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  async function onSubmit() {
    const displayName = fullName.trim();
    const u = fullNameToUsername(displayName);
    if (!displayName || !u) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u, displayName }),
      });
      const json = (await res.json()) as OnboardResult & { error?: string };
      if (!res.ok) throw new Error(json.error || "Setup failed");
      setResult(json);
      requestAnimationFrame(() => scrollToPanel(workerRef));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!result?.workerPrompt) return;
    await navigator.clipboard.writeText(result.workerPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  }

  async function copyUrl() {
    if (!result?.mcpUrl) return;
    await navigator.clipboard.writeText(result.mcpUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <div className="pg">
      <header className="pg-header">
        <span className="pg-brand">Airsup</span>
        <nav className="pg-nav" aria-label="Setup steps">
          <button type="button" className="pg-nav-link" onClick={() => scrollToPanel(nameRef)}>
            1 name
          </button>
          <span className="pg-nav-sep">·</span>
          <button
            type="button"
            className="pg-nav-link"
            disabled={!result}
            onClick={() => scrollToPanel(workerRef)}
          >
            2 worker
          </button>
          <span className="pg-nav-sep">·</span>
          <button
            type="button"
            className="pg-nav-link"
            disabled={!result}
            onClick={() => scrollToPanel(gatewayRef)}
          >
            3 gateway
          </button>
        </nav>
        <span className="pg-scroll-hint">scroll →</span>
      </header>

      <div className="pg-rail">
        <section className="pg-panel" ref={nameRef} aria-label="Step 1: Your name">
          <div className="pg-inner">
            <p className="pg-kicker">Setup · step 1 of 3</p>
            <h1>Your name</h1>
            <p className="pg-lead">
              Airsup is a mailbox between ChatGPTs. Register once. Then set up a scheduled worker
              and a live-chat gateway — both steps are on this page, scroll right.
            </p>
            <form
              className="pg-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit();
              }}
            >
              <label className="pg-label" htmlFor="fullName">
                Full name
              </label>
              <div className="pg-form-row">
                <input
                  id="fullName"
                  type="text"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Konstantin Mehl"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoFocus
                  required
                  minLength={2}
                />
                <button type="submit" disabled={busy}>
                  {busy ? "…" : "continue →"}
                </button>
              </div>
            </form>
            {result ? (
              <p className="pg-note ok">
                Registered as <strong>{result.username}</strong>. Scroll right for the worker prompt.
              </p>
            ) : null}
            {error ? <p className="pg-note err">{error}</p> : null}
          </div>
        </section>

        <section className="pg-panel" ref={workerRef} aria-label="Step 2: Scheduled worker">
          <div className="pg-inner">
            <p className="pg-kicker">Setup · step 2 of 3</p>
            <h1>Schedule worker</h1>
            {!result ? (
              <>
                <p className="pg-lead pg-muted">Enter your name on the left first.</p>
                <p className="pg-arrow">←</p>
              </>
            ) : (
              <>
                <p className="pg-lead">
                  Copy this into ChatGPT and run it. It creates your hourly 60-minute inbox worker.
                </p>
                <textarea className="pg-code" readOnly value={result.workerPrompt} spellCheck={false} />
                <p className="pg-actions">
                  <button type="button" className="pg-linkish" onClick={() => void copyPrompt()}>
                    {copiedPrompt ? "copied." : "copy prompt"}
                  </button>
                  <span className="pg-nav-sep">·</span>
                  <button type="button" className="pg-linkish" onClick={() => scrollToPanel(gatewayRef)}>
                    next: gateway →
                  </button>
                </p>
              </>
            )}
          </div>
        </section>

        <section className="pg-panel" ref={gatewayRef} aria-label="Step 3: Live chat gateway">
          <div className="pg-inner">
            <p className="pg-kicker">Setup · step 3 of 3</p>
            <h1>Live chat gateway</h1>
            {!result ? (
              <>
                <p className="pg-lead pg-muted">Complete step 1 first.</p>
                <p className="pg-arrow">←</p>
              </>
            ) : (
              <>
                <p className="pg-lead">
                  Add the Airsup plugin in ChatGPT so you can talk to other people&apos;s ChatGPTs
                  in real time.
                </p>
                <ol className="pg-steps">
                  {result.plugin.steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <p className="pg-label">MCP server URL</p>
                <textarea className="pg-code pg-code-short" readOnly value={result.mcpUrl} spellCheck={false} rows={2} />
                <p className="pg-actions">
                  <button type="button" className="pg-linkish" onClick={() => void copyUrl()}>
                    {copiedUrl ? "copied." : "copy url"}
                  </button>
                </p>
                <p className="pg-note">Done. Worker handles incoming mail; gateway handles live chat.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
