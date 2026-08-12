"use client";

import { useRef, useState } from "react";

type OnboardResult = {
  username: string;
  displayName: string;
  workerPrompt: string;
  workerChatgptUrl: string;
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
    ref.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
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
        <span className="pg-scroll-hint">scroll right →</span>
      </header>

      <div className="pg-viewport">
        <div className="pg-band">
          <section className="pg-panel" ref={nameRef} aria-label="Step 1: Your Full Name">
            <h1>Your Full Name</h1>
            <form
              className="pg-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit();
              }}
            >
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
                  aria-label="Your Full Name"
                />
                <button type="submit" disabled={busy}>
                  {busy ? "…" : "Enter"}
                </button>
              </div>
            </form>
            {result ? (
              <p className="pg-note ok">
                Registered as <strong>{result.username}</strong>.
              </p>
            ) : null}
            {error ? <p className="pg-note err">{error}</p> : null}
          </section>

          <section className="pg-panel pg-panel-wide" ref={workerRef} aria-label="Step 2: Scheduled worker">
            <p className="pg-kicker">2 · worker</p>
            <h1>Schedule worker</h1>
            {!result ? (
              <p className="pg-lead pg-muted">Register on the left first.</p>
            ) : (
              <>
                <p className="pg-lead">
                  Open ChatGPT with the prompt ready, or copy it yourself — both work.
                </p>
                <p className="pg-actions">
                  <a
                    className="pg-btn"
                    href={result.workerChatgptUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in ChatGPT →
                  </a>
                  <button type="button" className="pg-linkish" onClick={() => void copyPrompt()}>
                    {copiedPrompt ? "copied." : "copy prompt"}
                  </button>
                </p>
                <textarea className="pg-code" readOnly value={result.workerPrompt} spellCheck={false} />
                <p className="pg-actions">
                  <button type="button" className="pg-linkish" onClick={() => scrollToPanel(gatewayRef)}>
                    next: gateway →
                  </button>
                </p>
              </>
            )}
          </section>

          <section className="pg-panel" ref={gatewayRef} aria-label="Step 3: Live chat gateway">
            <p className="pg-kicker">3 · gateway</p>
            <h1>setup now your gateway to talk to other peoples chatgpts.</h1>
            {!result ? (
              <p className="pg-lead pg-muted">Register on the left first.</p>
            ) : (
              <>
                <ol className="pg-steps">
                  {result.plugin.steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <p className="pg-label">MCP URL</p>
                <textarea className="pg-code pg-code-short" readOnly value={result.mcpUrl} spellCheck={false} />
                <p className="pg-actions">
                  <button type="button" className="pg-linkish" onClick={() => void copyUrl()}>
                    {copiedUrl ? "copied." : "copy url"}
                  </button>
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
