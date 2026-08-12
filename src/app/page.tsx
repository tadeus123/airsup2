"use client";

import { useState } from "react";

type OnboardResult = {
  username: string;
  displayName: string;
  workerPrompt: string;
  mcpUrl: string;
  plugin: { steps: string[] };
};

type SetupStep = "form" | "worker" | "gateway";

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
  const [fullName, setFullName] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [step, setStep] = useState<SetupStep>("form");
  const [busy, setBusy] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [error, setError] = useState("");

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
      setStep("worker");
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
    setTimeout(() => setCopiedPrompt(false), 1500);
  }

  async function copyUrl() {
    if (!result?.mcpUrl) return;
    await navigator.clipboard.writeText(result.mcpUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  }

  return (
    <main className={`setup${step !== "form" ? " setup-done" : ""}`}>
      {step === "form" ? (
        <>
          <h1>Your Full Name</h1>
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
          >
            <div className="setup-row">
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
              />
              <button type="submit" disabled={busy}>
                {busy ? "…" : "Enter"}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {step === "worker" && result ? (
        <div className="setup-stage setup-stage-worker">
          <div className="setup-topbar">
            <button type="button" className="setup-finish" onClick={() => setStep("gateway")}>
              Finish setup
            </button>
          </div>
          <h1>Copy paste into ChatGPT and run prompt to setup your schedule worker</h1>
          <textarea
            className="setup-prompt setup-prompt-single"
            readOnly
            value={result.workerPrompt}
            spellCheck={false}
          />
          <button type="button" className="setup-copy" onClick={() => void copyPrompt()}>
            {copiedPrompt ? "Copied" : "Copy prompt"}
          </button>
        </div>
      ) : null}

      {step === "gateway" && result ? (
        <div className="setup-stage setup-plugin">
          <h1>setup now your gateway to talk to other peoples chatgpts.</h1>
          <ol className="setup-steps">
            {result.plugin.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <label className="setup-label">MCP Server URL</label>
          <textarea className="setup-prompt" readOnly value={result.mcpUrl} spellCheck={false} rows={3} />
          <button type="button" className="setup-copy" onClick={() => void copyUrl()}>
            {copiedUrl ? "Copied" : "Copy URL"}
          </button>
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
    </main>
  );
}
