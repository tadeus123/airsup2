"use client";

import { useState } from "react";

type Step = "name" | "worker";

type OnboardResult = {
  username: string;
  displayName: string;
  setupPrompt: string;
  schedulePrompt?: string;
  chatgptUrl: string;
  mcpUrl: string;
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
  const [step, setStep] = useState<Step>("name");
  const [fullName, setFullName] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const setupPrompt =
    result?.setupPrompt || result?.schedulePrompt || "";

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
      setResult({
        ...json,
        setupPrompt: json.setupPrompt || json.schedulePrompt || "",
      });
      setStep("worker");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!setupPrompt) return;
    await navigator.clipboard.writeText(setupPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className={`setup${step === "worker" ? " setup-done setup-wide" : ""}`}>
      {step === "name" ? (
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
        <div className="setup-worker">
          <h1 className="setup-worker-title">Set up ChatGPT worker</h1>
          <p className="setup-worker-lead">
            Both options run the same prompt — plugin + 15-minute scheduled worker for{" "}
            <strong>{result.displayName}</strong> (@{result.username}).
          </p>

          <div className="setup-worker-grid">
            <section className="setup-worker-panel">
              <h2>Option A — Open ChatGPT</h2>
              <p className="setup-worker-hint">
                Opens a new ChatGPT chat with the prompt loaded. Press Enter in ChatGPT to
                run it.
              </p>
              <a
                className="setup-copy setup-worker-cta"
                href={result.chatgptUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in ChatGPT
              </a>
            </section>

            <section className="setup-worker-panel">
              <h2>Option B — Copy &amp; paste</h2>
              <p className="setup-worker-hint">
                Copy the full prompt below and paste it into any ChatGPT chat (Developer mode
                on).
              </p>
              <textarea
                className="setup-prompt setup-worker-prompt"
                readOnly
                value={setupPrompt}
                spellCheck={false}
              />
              <button type="button" className="setup-copy" onClick={() => void copyPrompt()}>
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </section>
          </div>
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
    </main>
  );
}
