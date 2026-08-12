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
        <a className="pg-brand" href="/" onClick={(e) => { e.preventDefault(); scrollToPanel(nameRef); }}>
          Airsup
        </a>
        <span className="pg-nav">
          <button type="button" onClick={() => scrollToPanel(nameRef)}>1</button>
          <button type="button" disabled={!result} onClick={() => scrollToPanel(workerRef)}>2</button>
          <button type="button" disabled={!result} onClick={() => scrollToPanel(gatewayRef)}>3</button>
        </span>
      </header>

      <div className="pg-viewport">
        <div className="pg-band">
          <section className="pg-panel" ref={nameRef} aria-label="Name">
            <h1>Your Full Name</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit();
              }}
            >
              <input
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
            </form>
            {error ? <p className="err">{error}</p> : null}
          </section>

          <section className="pg-panel pg-wide" ref={workerRef} aria-label="Worker">
            <h1>Worker</h1>
            {!result ? (
              <p className="dim">←</p>
            ) : (
              <>
                <p>
                  <a href={result.workerChatgptUrl} target="_blank" rel="noreferrer">
                    open chatgpt
                  </a>
                  {" · "}
                  <button type="button" className="link" onClick={() => void copyPrompt()}>
                    {copiedPrompt ? "copied" : "copy"}
                  </button>
                </p>
                <textarea readOnly value={result.workerPrompt} spellCheck={false} />
              </>
            )}
          </section>

          <section className="pg-panel" ref={gatewayRef} aria-label="Gateway">
            <h1>Gateway</h1>
            {!result ? (
              <p className="dim">←</p>
            ) : (
              <>
                <ol>
                  {result.plugin.steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <p>
                  <button type="button" className="link" onClick={() => void copyUrl()}>
                    {copiedUrl ? "copied" : "copy url"}
                  </button>
                </p>
                <textarea className="short" readOnly value={result.mcpUrl} spellCheck={false} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
