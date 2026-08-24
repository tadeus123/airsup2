"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CompanyNav } from "./CompanyChrome";

export default function CompanyGoLivePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [stance, setStance] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, domain, apiKey, stance, contextNotes }),
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
    <main className="ainet co-page">
      <CompanyNav subtitle="company" />

      <div className="ainet-tagline">
        <p>turn on a counterpart other AIs can talk to.</p>
        <p>no website install. just your domain and your key.</p>
      </div>

      <form className="co-form" onSubmit={(e) => void onSubmit(e)}>
        <label className="co-field">
          <span>company name</span>
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
          <span>domain</span>
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
          <em>buyer AIs find you on the web, then Airsup checks this domain.</em>
        </label>

        <label className="co-field">
          <span>openai api key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <em>your model, your bill. Airsup never talks to visitors with this key — only your company AI does.</em>
        </label>

        <label className="co-field">
          <span>how should your AI negotiate?</span>
          <textarea
            value={stance}
            onChange={(e) => setStance(e.target.value)}
            placeholder="who you are, what you want, what you never do, how creative the deals may get, when a human must confirm…"
            rows={6}
            disabled={busy}
          />
        </label>

        <label className="co-field">
          <span>private notes (optional)</span>
          <textarea
            value={contextNotes}
            onChange={(e) => setContextNotes(e.target.value)}
            placeholder="products, typical terms, capacity, anything your AI should know and not dump as a brochure"
            rows={5}
            disabled={busy}
          />
        </label>

        {error ? <p className="ainet-note err">{error}</p> : null}

        <button type="submit" className="co-go" disabled={busy}>
          {busy ? "going live…" : "go live"}
        </button>
      </form>
    </main>
  );
}
