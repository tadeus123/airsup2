"use client";

import { useState } from "react";

type Step = "name" | "worker" | "plugin";

type OnboardResult = {
  username: string;
  displayName: string;
  workerPrompt: string;
  workerChatgptUrl: string;
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
  const [copied, setCopied] = useState<"prompt" | "url" | "">("");
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

  async function copy(kind: "prompt" | "url", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <main
      className={`setup${step !== "name" ? " setup-done setup-wide" : ""}`}
    >
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
          <h1 className="setup-worker-title">Create the worker</h1>
          <p className="setup-worker-lead">
            Same prompt both ways — creates the 15-minute scheduled task for{" "}
            <strong>{result.displayName}</strong> (@{result.username}). Plugin comes
            next.
          </p>

          <div className="setup-worker-grid">
            <section className="setup-worker-panel">
              <h2>Option A — Open ChatGPT</h2>
              <p className="setup-worker-hint">
                Opens ChatGPT with the prompt loaded. Press Enter there to run it.
              </p>
              <a
                className="setup-copy setup-worker-cta"
                href={result.workerChatgptUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in ChatGPT
              </a>
            </section>

            <section className="setup-worker-panel">
              <h2>Option B — Copy &amp; paste</h2>
              <p className="setup-worker-hint">
                Copy the prompt and paste into any ChatGPT chat (Developer mode on).
              </p>
              <textarea
                className="setup-prompt setup-worker-prompt"
                readOnly
                value={result.workerPrompt}
                spellCheck={false}
              />
              <button
                type="button"
                className="setup-copy"
                onClick={() => void copy("prompt", result.workerPrompt)}
              >
                {copied === "prompt" ? "Copied" : "Copy prompt"}
              </button>
            </section>
          </div>

          <button
            type="button"
            className="setup-copy setup-worker-next"
            onClick={() => setStep("plugin")}
          >
            Next — add plugin
          </button>
        </div>
      ) : null}

      {step === "plugin" && result ? (
        <div className="setup-plugin">
          <h1 className="setup-worker-title">Add the Airsup plugin</h1>
          <p className="setup-worker-lead">
            Connect MCP so the worker can reach your inbox. Username:{" "}
            <strong>{result.username}</strong>
          </p>

          <ol className="setup-steps">
            <li>ChatGPT → Settings → enable <strong>Developer mode</strong></li>
            <li>ChatGPT → Plugins → <strong>+ New Plugin</strong></li>
            <li>
              Name: <strong>Airsup {result.username}</strong>
            </li>
            <li>
              Connection: <strong>Server URL</strong>
            </li>
            <li>Paste the Server URL below (token included)</li>
            <li>
              Authentication: <strong>None</strong>
            </li>
            <li>
              Create → Refresh tools → enable watch_batch, reply_and_ack, talk_to_user,
              await_reply, list_users
            </li>
            <li>
              On your scheduled worker task: enable the Airsup plugin →{" "}
              <strong>Always allow</strong>
            </li>
          </ol>

          <label className="setup-label">Server URL</label>
          <textarea className="setup-prompt" readOnly value={result.mcpUrl} rows={3} />
          <button
            type="button"
            className="setup-copy"
            onClick={() => void copy("url", result.mcpUrl)}
          >
            {copied === "url" ? "Copied" : "Copy Server URL"}
          </button>
        </div>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
    </main>
  );
}
