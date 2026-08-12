"use client";

import { useState } from "react";

type Step = "username" | "plugin" | "schedule";

type OnboardResult = {
  username: string;
  displayName: string;
  token: string;
  chatgptUrl: string;
  schedulePrompt: string;
  scheduleDescription?: string;
  scheduleName?: string;
  mcpUrl: string;
  plugin: { mcpUrl: string; steps: string[] };
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

function taskInstructionsOnly(schedulePrompt: string) {
  return schedulePrompt
    .replace(/^[\s\S]*BEGIN_INSTRUCTIONS\n/, "")
    .replace(/\nEND_INSTRUCTIONS[\s\S]*$/, "");
}

function fullNameToUsername(name: string) {
  const first = name.trim().split(/\s+/)[0] || name.trim();
  return cleanUsername(first);
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("username");
  const [fullName, setFullName] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<
    "plugin" | "prompt" | "instructions" | "description" | "name" | ""
  >("");
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
      setStep("plugin");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(
    kind: "plugin" | "prompt" | "instructions" | "description" | "name",
    value: string
  ) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(""), 1500);
  }

  const mcpUrl = result?.mcpUrl || result?.plugin?.mcpUrl || "";
  const scheduleName =
    result?.scheduleName || (result ? `Airsup Continuous Worker - ${result.username}` : "");
  const scheduleDescription =
    result?.scheduleDescription ||
    (result ? `Airsup scanner for ${result.username} every 15m` : "");

  return (
    <main className={`setup${step !== "username" ? " setup-done" : ""}`}>
      {step === "username" ? (
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

      {step === "plugin" && result ? (
        <>
          <h1>Add the Airsup plugin.</h1>
          <p className="setup-sub">
            Developer Mode MCP plugin first. Without it, the scheduled worker has no tools.
          </p>
          <p className="setup-sub">
            Username: <strong>{result.username}</strong>
          </p>
          <ol className="setup-steps">
            <li>ChatGPT → Settings → enable <strong>Developer mode</strong></li>
            <li>ChatGPT → Plugins → <strong>+ New Plugin</strong></li>
            <li>Name: <strong>Airsup {result.username}</strong></li>
            <li>Connection: <strong>Server URL</strong></li>
            <li>Paste the Server URL below (token included)</li>
            <li>Authentication: <strong>None</strong></li>
            <li>Create → Refresh tools → enable watch_batch, talk_to_user, await_reply, list_users</li>
            <li>New chat → Developer mode → enable Airsup → <strong>Always allow</strong></li>
          </ol>
          <label className="setup-label">Server URL</label>
          <textarea className="setup-prompt" readOnly value={mcpUrl} rows={3} />
          <button type="button" className="setup-copy" onClick={() => void copy("plugin", mcpUrl)}>
            {copied === "plugin" ? "Copied" : "Copy Server URL"}
          </button>
          <div className="setup-actions">
            <button type="button" className="setup-copy" onClick={() => setStep("schedule")}>
              Next — create worker
            </button>
          </div>
        </>
      ) : null}

      {step === "schedule" && result ? (
        <>
          <h1>Create the continuous worker.</h1>
          <p className="setup-sub">
            Schedule every 15 minutes. Uses watch_batch (~100s internal polls). Unacked events replay until
            reply_and_ack succeeds.
          </p>
          <label className="setup-label">Name</label>
          <textarea className="setup-prompt" readOnly value={scheduleName} rows={2} />
          <button
            type="button"
            className="setup-copy setup-copy-muted"
            onClick={() => void copy("name", scheduleName)}
          >
            {copied === "name" ? "Copied" : "Copy name"}
          </button>
          <label className="setup-label">Description</label>
          <textarea className="setup-prompt" readOnly value={scheduleDescription} rows={3} />
          <button
            type="button"
            className="setup-copy"
            onClick={() => void copy("description", scheduleDescription)}
          >
            {copied === "description" ? "Copied" : "Copy description"}
          </button>
          <label className="setup-label">Task instructions</label>
          <textarea
            className="setup-prompt"
            readOnly
            value={taskInstructionsOnly(result.schedulePrompt)}
            rows={10}
          />
          <div className="setup-actions">
            <a className="setup-copy" href={result.chatgptUrl} target="_blank" rel="noreferrer">
              Open ChatGPT with schedule prompt
            </a>
            <button
              type="button"
              className="setup-copy setup-copy-muted"
              onClick={() =>
                void copy("instructions", taskInstructionsOnly(result.schedulePrompt))
              }
            >
              {copied === "instructions" ? "Copied" : "Copy task instructions"}
            </button>
            <button
              type="button"
              className="setup-copy setup-copy-muted"
              onClick={() => void copy("prompt", result.schedulePrompt)}
            >
              {copied === "prompt" ? "Copied prompt" : "Copy full setup prompt"}
            </button>
            <button type="button" className="setup-copy setup-copy-muted" onClick={() => setStep("plugin")}>
              Back
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
    </main>
  );
}
