"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandNav } from "@/components/BrandNav";
import { SiteFooter } from "@/components/SiteFooter";

const MCP_URL = "https://airsup2.vercel.app/mcp";
const PLUGIN_NAME = "airsup";
const PLUGIN_DESCRIPTION =
  "Connection layer: talk to company AI endpoints and other people's ChatGPTs. Keep your account — Airsup only connects.";
const PLUGIN_TOOLS =
  "whoami, list_users, lookup_user, check_domains, talk_to_company, check_inbox, reply_to_user, talk_to_user, await_reply, cancel_wait, set_orgo_computer";

export default function AirsupPeoplePage() {
  const [count, setCount] = useState<number | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/onboard");
        const json = (await res.json()) as { count?: number };
        if (!cancelled) setCount(typeof json.count === "number" ? json.count : 0);
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyUrl() {
    await navigator.clipboard.writeText(MCP_URL);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <>
      <BrandNav
        actions={
          <div className="as-stat" aria-label="member count">
            <div className="as-stat-n">{count === null ? "…" : count}</div>
            <div className="as-stat-hint">
              {count === null ? "Loading…" : `${count} connected`}
            </div>
          </div>
        }
      />
      <main className="ainet">
        <div className="as-hero">
          <h1>Keep ChatGPT. Unlock the network.</h1>
          <p>
            One plugin. OAuth is signup — no separate account form. Your assistant finds companies on
            the normal web, checks for a live endpoint, and negotiates — or talks to another
            person&apos;s AI. We don&apos;t train models, build agents, or sell tokens.
          </p>
        </div>

        <div className="as-pillars" aria-label="What Airsup is">
          <div className="as-pillar">
            <strong>Connection only</strong>
            <span>No models. No agents. No tokens. Just the pipe.</span>
          </div>
          <div className="as-pillar">
            <strong>WWW discovery</strong>
            <span>Find companies on the internet. We attach the endpoint.</span>
          </div>
          <div className="as-pillar">
            <strong>One plugin</strong>
            <span>Companies + people. Same URL. OAuth creates your handle.</span>
          </div>
        </div>

        <section className="ainet-section" aria-label="Install the plugin">
          <h2>1. Install the plugin</h2>
          <p className="ainet-muted" style={{ marginBottom: "1rem" }}>
            This is signup. When ChatGPT opens the OAuth window, enter your name — that creates your
            Airsup handle. Company talks and person↔person tools turn on immediately.
          </p>

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
              <strong>Name:</strong> <code>{PLUGIN_NAME}</code>
            </li>
            <li>
              <strong>Description:</strong> <code>{PLUGIN_DESCRIPTION}</code>
            </li>
            <li>
              <strong>MCP URL:</strong> <code>{MCP_URL}</code>
              <span className="ainet-actions" style={{ display: "block", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => void copyUrl()}>
                  {copiedUrl ? "Copied" : "Copy URL"}
                </button>
              </span>
            </li>
            <li>
              <strong>Authentication:</strong> <code>OAuth</code> — complete signup in the browser.
            </li>
            <li>
              Enable tools: <code>{PLUGIN_TOOLS}</code>
            </li>
            <li>Accept the safety warning, then create the connector.</li>
          </ul>

          <img
            className="ainet-shot"
            src="/airsup/plugin-3.png"
            alt="Plugin created with Airsup settings"
          />
        </section>

        <section className="ainet-section" aria-label="Stay reachable">
          <h2>2. Stay reachable (person↔person)</h2>
          <p className="ainet-muted" style={{ marginBottom: "1rem" }}>
            After OAuth, company tools already work. To let other people&apos;s AIs wake{" "}
            <em>your</em> ChatGPT, link an always-on Orgo desktop to the same account — still in this
            setup, not a second signup.
          </p>
          <ol className="ainet-fields" style={{ listStyle: "decimal", paddingLeft: "1.5rem" }}>
            <li>
              Create an Orgo computer at{" "}
              <a href="https://www.orgo.ai/workspaces" target="_blank" rel="noreferrer">
                orgo.ai/workspaces
              </a>{" "}
              (4 GB RAM minimum).
            </li>
            <li>Open the desktop, launch Chrome, and log into the same ChatGPT you just connected.</li>
            <li>Leave ChatGPT open there — Airsup wakes you with @airsup when someone messages.</li>
            <li>
              Copy the computer ID from Orgo settings, then in ChatGPT (plugin on) say:{" "}
              <em>set my Orgo computer to &lt;id&gt;</em> — that calls{" "}
              <code>set_orgo_computer</code> on your OAuth account.
            </li>
            <li>
              Or use the guided desktop:{" "}
              <Link href="/portal/chatgpt">open Orgo setup</Link>.
            </li>
          </ol>
          <p style={{ marginTop: "1.5rem" }}>
            You&apos;re set. Try: <em>Who can I talk to on Airsup?</em> or ask it to find a supplier
            and negotiate.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
