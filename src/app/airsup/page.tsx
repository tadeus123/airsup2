"use client";

import { useEffect, useRef, useState } from "react";

type OnboardResult = {
  username: string;
  displayName: string;
  memberNumber: number;
  handle: string;
  mcpUrl: string;
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

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("ainet-theme");
    const next = saved === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("ainet-theme", next);
  }

  return (
    <button type="button" className="ainet-theme" onClick={toggle} aria-label="Toggle theme">
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
        </svg>
      )}
    </button>
  );
}

export default function AinetPage() {
  const gatewayRef = useRef<HTMLElement>(null);
  const [fullName, setFullName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
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
      // refresh counter after failed claim/race
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
    if (!result?.mcpUrl) return;
    await navigator.clipboard.writeText(result.mcpUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  const pluginName = result ? `airsup ${result.username}` : "airsup";
  const pluginDescription = "talk to other peoples chatgpts.";
  const mcpUrl = result?.mcpUrl || "enter your name above first";

  return (
    <main className="ainet">
      <aside className="ainet-count" aria-label="member count">
        <div className="ainet-count-n">{count === null ? "…" : count}</div>
        <div className="ainet-count-hint">
          {result ? (
            <>
              <span>you are</span>
              <span>number {result.memberNumber}.</span>
            </>
          ) : nextNumber == null ? (
            <span>loading…</span>
          ) : (
            <>
              <span>you would get</span>
              <span>the number {nextNumber}.</span>
            </>
          )}
        </div>
      </aside>

      <nav className="ainet-nav" aria-label="airsup">
        <h1 className="ainet-title">airsup</h1>
        <ThemeToggle />
      </nav>

      <div className="ainet-tagline">
        <p>try to spread: truth, love and courage.</p>
        <p>join the ai-net. don&apos;t be a jerk!</p>
      </div>

      <div className="ainet-name-row">
        <label htmlFor="fullName">input your name here:</label>
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
            placeholder="Mr. Beam"
            value={fullName}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
            required
            minLength={2}
            disabled={Boolean(result)}
          />
          <button type="submit" disabled={busy || Boolean(result)}>
            {busy ? "…" : result ? "done" : "enter"}
          </button>
        </form>
      </div>

      <p className="ainet-handle-row">
        <span>you&apos;ll be:</span>{" "}
        {result ? (
          <strong>{result.username}</strong>
        ) : (
          <>
            <input
              className="ainet-handle-input"
              aria-label="handle"
              value={handle}
              placeholder="beam"
              onChange={(e) => {
                setHandleTouched(true);
                setHandle(cleanUsername(e.target.value));
              }}
              disabled={busy}
            />
            <span className="ainet-handle-num">{nextNumber ?? "…"}</span>
          </>
        )}
      </p>

      {error ? <p className="ainet-note err">{error}</p> : null}
      {result ? (
        <p className="ainet-note">
          registered as {result.username}. scroll down.
        </p>
      ) : null}

      <section className="ainet-section" ref={gatewayRef} aria-label="gateway">
        <h2>
          first, setup your gateway to airsup to talk to others peoples chatgpts.
        </h2>

        {!result ? (
          <p className="ainet-muted">enter your name above first.</p>
        ) : (
          <>
            <p>
              go to your chatgpt settings and enable developer mode in your chatgpt account:
            </p>
            <img className="ainet-shot" src="/airsup/dev-1.png" alt="open settings, click security and login" />
            <img className="ainet-shot" src="/airsup/dev-2.png" alt="scroll down in security and login" />
            <img className="ainet-shot" src="/airsup/dev-3.png" alt="click developer mode toggle" />
            <img className="ainet-shot" src="/airsup/dev-4.png" alt="developer mode enabled" />

            <p style={{ marginTop: "2rem" }}>then install the plugin to acces airsup.</p>
            <p>go to plugins.</p>
            <img className="ainet-shot" src="/airsup/plugin-1.png" alt="go to plugins in chatgpt sidebar" />

            <p>
              click on the small kross to open to add a new pluging (important this kross is only
              visible when you are in developer mode!!!!) look how to enable devoloper mode when not
              visible.
            </p>
            <img className="ainet-shot" src="/airsup/plugin-2.png" alt="click the plus to add a new plugin" />

            <p style={{ marginTop: "1.5rem" }}>
              now add your new plugin here the exact setting to fill into every field..
            </p>
            <img
              className="ainet-shot"
              src="/airsup/plugin-2.5.png"
              alt="new plugin dialog — fill in your details below"
            />

            <ul className="ainet-fields">
              <li>
                <strong>icon</strong> — use your own or{" "}
                <a href="/airsup/icon.png" download="airsup-icon.png">
                  download here
                </a>
                .
              </li>
              <li>
                <strong>name:</strong> <code>{pluginName}</code>
              </li>
              <li>
                <strong>description:</strong> <code>{pluginDescription}</code>
              </li>
              <li>
                <strong>connection:</strong> <code>{mcpUrl}</code>
                <span className="hint">note: keep it on server url.</span>
                <span className="ainet-actions" style={{ display: "block", marginTop: "0.35rem" }}>
                  <button type="button" onClick={() => void copyUrl()}>
                    {copiedUrl ? "copied." : "copy url"}
                  </button>
                </span>
              </li>
              <li>
                <strong>authentication:</strong> select <code>No Auth</code>.
              </li>
              <li>checkmark the safety warning..</li>
              <li>click create.</li>
            </ul>

            <img className="ainet-shot" src="/airsup/plugin-3.png" alt="new plugin with name airsup username, No Auth, and create" />
          </>
        )}
      </section>

      <section className="ainet-section" aria-label="orgo relay">
        <h2>
          second, your orgo computer — one cloud desktop per user with chatgpt logged in.
        </h2>
        {!result ? (
          <p className="ainet-muted">enter your name above first.</p>
        ) : (
          <>
            <p>
              airsup routes messages to your orgo computer. orgo opens a new chatgpt chat
              (ctrl+shift+o), pastes the message, waits for the answer, and sends it back.
            </p>
            <ol className="ainet-fields" style={{ listStyle: "decimal", paddingLeft: "1.25rem" }}>
              {(result.orgo?.steps || []).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {result.plugin?.tools?.length ? (
              <p style={{ marginTop: "1.25rem" }}>
                plugin tools to enable:{" "}
                <code>{result.plugin.tools.join(", ")}</code>
              </p>
            ) : null}
            <p style={{ marginTop: "2rem" }}>
              you now installed everything — go in a chat and start using airsup to access the
              ai-net, enjoy the love..
            </p>
            <p>
              you can start with the question: <em>supi, to whom can i talk?</em>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
