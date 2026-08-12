"use client";

import { useState } from "react";

type OnboardResult = {
  username: string;
  displayName: string;
  workerPrompt: string;
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
  const [fullName, setFullName] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!result?.workerPrompt) return;
    await navigator.clipboard.writeText(result.workerPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className={`setup${result ? " setup-done" : ""}`}>
      {!result ? (
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
      ) : (
        <>
          <h1>Copy paste into ChatGPT and run prompt to setup your schedule worker</h1>
          <textarea
            className="setup-prompt setup-prompt-single"
            readOnly
            value={result.workerPrompt}
            spellCheck={false}
          />
          <button type="button" className="setup-copy" onClick={() => void copyPrompt()}>
            {copied ? "Copied" : "Copy prompt"}
          </button>
        </>
      )}

      {error ? <p className="err">{error}</p> : null}
    </main>
  );
}
