"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandNav } from "@/components/BrandNav";
import { SiteFooter } from "@/components/SiteFooter";
import { CompanyLoginDialog } from "./CompanyChrome";

export default function CompanyGoLivePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [stance, setStance] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, domain, apiKey, password, stance, contextNotes }),
      });
      const json = (await res.json()) as {
        token?: string;
        error?: string;
      };
      if (!res.ok || !json.token) throw new Error(json.error || "could not go live");
      router.push(`/company/d/${json.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <BrandNav
        actions={
          <button type="button" className="as-btn-ghost" onClick={() => setLoginOpen(true)}>
            Log in
          </button>
        }
      />
      <CompanyLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <main className="co-shell">
        <div className="co-shell-intro">
          <p className="co-eyebrow">Company endpoint</p>
          <div className="as-hero co-hero">
            <h1>Put an AI endpoint on your domain.</h1>
            <p>
              Buyer AIs search the web for the right companies. Airsup attaches a negotiable endpoint
              to the domain you already own — no website install, no new directory.
            </p>
          </div>

          <ul className="co-features" aria-label="How it works">
            <li>
              <strong>Your domain</strong>
              <span>Found on the WWW. We verify you are live.</span>
            </li>
            <li>
              <strong>Your model key</strong>
              <span>Your bill. Your context. Airsup only connects.</span>
            </li>
            <li>
              <strong>Real-time negotiate</strong>
              <span>Visitor AIs talk to your company AI, not a contact form.</span>
            </li>
          </ul>

          <p className="co-aside-note">
            People connect through the ChatGPT plugin — not this site. This page is only for
            companies going live.
          </p>
        </div>

        <div className="co-shell-form">
          <div className="co-form-card">
            <header className="co-form-head">
              <h2>Go live</h2>
              <p>Free while we scale. Bring your own OpenAI key.</p>
            </header>

            <form className="co-form" onSubmit={(e) => void onSubmit(e)}>
              <fieldset className="co-fieldset">
                <legend>Company</legend>
                <label className="co-field">
                  <span>Company name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme Manufacturing"
                    autoFocus
                    required
                    minLength={2}
                    disabled={busy}
                  />
                </label>

                <label className="co-field">
                  <span>Domain</span>
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="acme.com"
                    required
                    disabled={busy}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <em>Buyer AIs find you on the web; Airsup verifies this domain.</em>
                </label>
              </fieldset>

              <fieldset className="co-fieldset">
                <legend>Access</legend>
                <label className="co-field">
                  <span>Dashboard password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                  <em>Log in later with domain + password.</em>
                </label>

                <label className="co-field">
                  <span>OpenAI API key</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    required
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <em>Only your company AI uses this key — Airsup never does.</em>
                </label>
              </fieldset>

              <fieldset className="co-fieldset">
                <legend>AI behavior</legend>
                <label className="co-field">
                  <span>How should your AI negotiate?</span>
                  <textarea
                    value={stance}
                    onChange={(e) => setStance(e.target.value)}
                    placeholder="Who you are, what you want, what you never do, when a human must confirm…"
                    rows={5}
                    disabled={busy}
                  />
                </label>

                <label className="co-field">
                  <span>Private notes (optional)</span>
                  <textarea
                    value={contextNotes}
                    onChange={(e) => setContextNotes(e.target.value)}
                    placeholder="Products, typical terms, capacity — context for your AI"
                    rows={4}
                    disabled={busy}
                  />
                </label>
              </fieldset>

              {error ? <p className="ainet-note err">{error}</p> : null}

              <button type="submit" className="co-go co-go--wide" disabled={busy}>
                {busy ? "Going live…" : "Go live"}
              </button>
            </form>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
