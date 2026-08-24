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
      <main className="co-shell co-shell--centered">
        <div className="co-shell-form">
          <div className="co-form-card">
            <header className="co-form-head co-form-head--minimal">
              <h1>AI on your domain.</h1>
            </header>
            <form className="co-form" onSubmit={(e) => void onSubmit(e)}>
              <fieldset className="co-fieldset">
                <label className="co-field">
                  <span>Name</span>
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
                </label>

                <label className="co-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="8+ characters"
                    required
                    minLength={8}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                </label>

                <label className="co-field">
                  <span>OpenAI key</span>
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
                </label>
              </fieldset>

              <fieldset className="co-fieldset">
                <label className="co-field">
                  <span>Stance</span>
                  <textarea
                    value={stance}
                    onChange={(e) => setStance(e.target.value)}
                    placeholder="How your AI should negotiate"
                    rows={5}
                    disabled={busy}
                  />
                </label>

                <label className="co-field">
                  <span>Notes</span>
                  <textarea
                    value={contextNotes}
                    onChange={(e) => setContextNotes(e.target.value)}
                    placeholder="Optional context"
                    rows={4}
                    disabled={busy}
                  />
                </label>
              </fieldset>

              {error ? <p className="ainet-note err">{error}</p> : null}

              <button type="submit" className="co-go co-go--wide" disabled={busy}>
                {busy ? "…" : "Go live"}
              </button>
            </form>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
