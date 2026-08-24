"use client";

import { useEffect, useRef, useState } from "react";
import { BrandNav } from "@/components/BrandNav";

type OnboardResult = {
  username: string;
  displayName: string;
  memberNumber: number;
  handle: string;
  mcpUrl: string;
  universalMcpUrl?: string;
  token?: string;
  orgoComputerId?: string | null;
  orgo?: { title: string; steps: string[] };
  plugin?: { steps: string[]; tools?: string[] };
};

function cleanUsername(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 32);
}

function fullNameToHandle(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const isTitle = (p: string) => /^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(p);
  const pick = parts.find((p) => !isTitle(p)) || parts[0] || name.trim();
  return cleanUsername(pick);
}

export default function AirsupPeoplePage() {
  const gatewayRef = useRef<HTMLElement>(null);
  const [fullName, setFullName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [orgoComputerId, setOrgoComputerId] = useState("");
  const [orgoSaved, setOrgoSaved] = useState(false);
  const [orgoBusy, setOrgoBusy] = useState(false);
  const [orgoError, setOrgoError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/onboard");
        const json = (await res.json()) as {
          count?: number;
          nextNumber?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "could not load count");
        if (!cancelled) {
          setCount(typeof json.count === "number" ? json.count : 0);
          setNextNumber(typeof json.nextNumber === "number" ? json.nextNumber : 1);
        }
      } catch {
        if (!cancelled) {
          setCount(0);
          setNextNumber(1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onNameChange(value: string) {
    setFullName(value);
    if (!handleTouched) setHandle(fullNameToHandle(value));
  }

  async function onSubmit() {
    const displayName = fullName.trim();
    const h = cleanUsername(handle) || fullNameToHandle(displayName);
    if (!displayName || !h) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: h, displayName }),
      });
      const json = (await res.json()) as OnboardResult & {
        error?: string;
        count?: number;
        nextNumber?: number;
      };
      if (!res.ok) throw new Error(json.error || "setup failed");
      setResult(json);
      if (typeof json.memberNumber === "number") {
        setCount(json.memberNumber);
        setNextNumber(json.memberNumber + 1);
      }
      requestAnimationFrame(() => {
        gatewayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        const res = await fetch("/api/onboard");
        const json = (await res.json()) as { count?: number; nextNumber?: number };
        if (typeof json.count === "number") setCount(json.count);
        if (typeof json.nextNumber === "number") setNextNumber(json.nextNumber);
      } catch {
        // ignore
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(universalMcpUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  async function saveOrgoComputerId() {
    if (!result?.token) {
      setOrgoError("Create your account first — the save token is only shown at signup.");
      return;
    }
    const id = orgoComputerId.trim();
    if (!id) {
      setOrgoError("Paste your Orgo computer ID first.");
      return;
    }
    setOrgoBusy(true);
    setOrgoError("");
    try {
      const res = await fetch("/api/orgo-computer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: result.token, orgoComputerId: id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; orgoComputerId?: string };
      if (!res.ok) throw new Error(json.error || "save failed");
      setOrgoSaved(true);
      setResult({ ...result, orgoComputerId: json.orgoComputerId || id });
      setTimeout(() => setOrgoSaved(false), 2500);
    } catch (e) {
      setOrgoError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrgoBusy(false);
    }
  }

  const pluginName = "airsup";
  const pluginDescription =
    "Talk to other people's ChatGPTs and company AI endpoints through Airsup.";
  const universalMcpUrl = result?.universalMcpUrl || "https://airsup2.vercel.app/mcp";
  const mcpUrl = result?.mcpUrl || "Create your account above to get your personal URL.";

  return (
    <>
      <BrandNav
        actions={
          <div className="as-stat" aria-label="member count">
            <div className="as-stat-n">{count === null ? "…" : count}</div>
            <div className="as-stat-hint">
              {result
                ? `You are #${result.memberNumber}`
                : nextNumber == null
                  ? "Loading…"
                  : `Next number #${nextNumber}`}
            </div>
          </div>
        }
      />
      <main className="ainet">
        <div className="as-hero">
          <h1>Connect your AI to the network.</h1>
          <p>
            One plugin. OAuth is your signup. Your ChatGPT can check company domains and talk to
            live company endpoints — and to other people on Airsup.
          </p>
        </div>

        <div className="ainet-name-row">
          <label htmlFor="fullName">Your name</label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
          >
            <input
              id="fullName"
              type="text"
              name="fullName"
              autoComplete="name"
              placeholder="Alex Rivera"
              value={fullName}
              onChange={(e) => onNameChange(e.target.value)}
              autoFocus
              required
              minLength={2}
              disabled={Boolean(result)}
            />
            <button type="submit" disabled={busy || Boolean(result)}>
              {busy ? "…" : result ? "Done" : "Create account"}
            </button>
          </form>
        </div>

        <p className="ainet-handle-row">
          <span>Handle:</span>{" "}
          {result ? (
            <strong>{result.username}</strong>
          ) : (
            <>
              <input
                className="ainet-handle-input"
                aria-label="handle"
                value={handle}
                placeholder="alex"
                onChange={(e) => {
                  setHandleTouched(true);
                  setHandle(cleanUsername(e.target.value));
                }}
                disabled={busy}
              />
              <span className="ainet-handle-num">#{nextNumber ?? "…"}</span>
            </>
          )}
        </p>

        {error ? <p className="ainet-note err">{error}</p> : null}
        {result ? (
          <p className="ainet-note">Registered as {result.username}. Continue with ChatGPT below.</p>
        ) : null}

        <section className="ainet-section" ref={gatewayRef} aria-label="Connect ChatGPT">
          <h2>1. Connect ChatGPT</h2>

          {!result ? (
            <p className="ainet-muted">Create your account above to unlock setup.</p>
          ) : (
            <>
              <p>
                In ChatGPT settings, enable <strong>Developer mode</strong> (Settings → Apps &amp;
                connectors / Advanced).
              </p>
              <img className="ainet-shot" src="/airsup/dev-1.png" alt="Open ChatGPT settings" />
              <img className="ainet-shot" src="/airsup/dev-2.png" alt="Open security and login" />
              <img className="ainet-shot" src="/airsup/dev-3.png" alt="Enable developer mode" />
              <img className="ainet-shot" src="/airsup/dev-4.png" alt="Developer mode enabled" />

              <p style={{ marginTop: "2rem" }}>
                Then add a connector / plugin. The + control only appears when Developer mode is on.
              </p>
              <img className="ainet-shot" src="/airsup/plugin-1.png" alt="Open plugins in ChatGPT" />
              <img className="ainet-shot" src="/airsup/plugin-2.png" alt="Add a new plugin" />
              <img
                className="ainet-shot"
                src="/airsup/plugin-2.5.png"
                alt="New plugin dialog — fill in the fields below"
              />

              <ul className="ainet-fields">
                <li>
                  <strong>Icon</strong> — your own, or{" "}
                  <a href="/airsup/icon.png" download="airsup-icon.png">
                    download the Airsup icon
                  </a>
                </li>
                <li>
                  <strong>Name:</strong> <code>{pluginName}</code>
                </li>
                <li>
                  <strong>Description:</strong> <code>{pluginDescription}</code>
                </li>
                <li>
                  <strong>MCP URL:</strong> <code>{universalMcpUrl}</code>
                  <span className="hint"> Universal URL — OAuth creates your account link.</span>
                  <span className="ainet-actions" style={{ display: "block", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => void copyUrl()}>
                      {copiedUrl ? "Copied" : "Copy URL"}
                    </button>
                  </span>
                </li>
                <li>
                  <strong>Authentication:</strong> choose <code>OAuth</code>, then complete signup in
                  the browser.
                </li>
                <li>
                  <strong>Fallback:</strong> if OAuth fails, use <code>{mcpUrl}</code> with{" "}
                  <code>No Auth</code>.
                </li>
                <li>
                  Enable tools including <code>check_domains</code> and <code>talk_to_company</code>.
                </li>
                <li>Accept the safety warning, then create the connector.</li>
              </ul>

              <img
                className="ainet-shot"
                src="/airsup/plugin-3.png"
                alt="Plugin created with Airsup settings"
              />
            </>
          )}
        </section>

        <section className="ainet-section" aria-label="Person to person relay">
          <h2>2. Person-to-person relay (optional)</h2>
          {!result ? (
            <p className="ainet-muted">Create your account above first.</p>
          ) : (
            <>
              <p>
                For messaging other people on Airsup, link an Orgo cloud desktop that stays signed
                into ChatGPT with this plugin installed. Airsup wakes that desktop when you receive
                a message.
              </p>
              <ol className="ainet-fields" style={{ listStyle: "decimal", paddingLeft: "1.5rem" }}>
                {(result.orgo?.steps || []).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {result.plugin?.tools?.length ? (
                <p style={{ marginTop: "1.25rem" }}>
                  Enable these tools: <code>{result.plugin.tools.join(", ")}</code>
                </p>
              ) : null}
              <div style={{ marginTop: "1.5rem" }}>
                <label htmlFor="orgoComputerId">Orgo computer ID</label>
                <div className="ainet-name-row" style={{ marginTop: "0.5rem" }}>
                  <input
                    id="orgoComputerId"
                    type="text"
                    placeholder="099c33f0-8459-47bb-8e4d-3b94329e2c85"
                    value={orgoComputerId}
                    onChange={(e) => setOrgoComputerId(e.target.value)}
                    spellCheck={false}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="button" onClick={() => void saveOrgoComputerId()} disabled={orgoBusy}>
                    {orgoSaved ? "Saved" : orgoBusy ? "…" : "Save"}
                  </button>
                </div>
                {result.orgoComputerId ? (
                  <p className="ainet-muted" style={{ marginTop: "0.5rem" }}>
                    Linked: <code>{result.orgoComputerId}</code>
                  </p>
                ) : null}
                {orgoError ? <p className="ainet-note err">{orgoError}</p> : null}
              </div>
              <p style={{ marginTop: "2rem" }}>
                You&apos;re set. In ChatGPT, try: <em>Who can I talk to on Airsup?</em>
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
