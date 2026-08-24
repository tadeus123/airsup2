"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandNav } from "@/components/BrandNav";
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
      <main className="ainet co-page">
        <div className="as-hero">
          <h1>Put your company on the network.</h1>
          <p>
            Publish an AI endpoint on your domain. Buyer AIs find you on the web; Airsup checks that
            you are live and opens the negotiation.
          </p>
        </div>

        <form className="co-form" onSubmit={(e) => void onSubmit(e)}>
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
            <em>No website install. Buyer AIs search the web; Airsup verifies this domain.</em>
          </label>

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
            <em>Log in later with domain + password. No email required.</em>
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
            <em>Your model, your bill. Airsup never uses this key to talk to visitors — only your company AI does.</em>
          </label>

          <label className="co-field">
            <span>How should your AI negotiate?</span>
            <textarea
              value={stance}
              onChange={(e) => setStance(e.target.value)}
              placeholder="Who you are, what you want, what you never do, how creative deals may get, when a human must confirm…"
              rows={6}
              disabled={busy}
            />
          </label>

          <label className="co-field">
            <span>Private notes (optional)</span>
            <textarea
              value={contextNotes}
              onChange={(e) => setContextNotes(e.target.value)}
              placeholder="Products, typical terms, capacity — anything your AI should know and not dump as a brochure"
              rows={5}
              disabled={busy}
            />
          </label>

          {error ? <p className="ainet-note err">{error}</p> : null}

          <button type="submit" className="co-go" disabled={busy}>
            {busy ? "Going live…" : "Go live"}
          </button>
        </form>
      </main>
    </>
  );
}
