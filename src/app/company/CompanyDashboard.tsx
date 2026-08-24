"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CompanyNav } from "./CompanyChrome";

type Company = {
  id: string;
  name: string;
  domain: string;
  keyLast4: string;
  stance: string;
  contextNotes: string;
};

type Conversation = {
  conversationId: string;
  visitorUsername: string;
  lastRole: string;
  lastBody: string;
  lastAt: string;
  messageCount: number;
  isTest: boolean;
};

type ChatMessage = {
  id: number;
  role: "visitor" | "company";
  body: string;
  visitorUsername: string;
  createdAt: string;
};

export default function CompanyDashboard() {
  const params = useParams();
  const token = String(params.token || "");
  const [company, setCompany] = useState<Company | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stance, setStance] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (conversationId?: string) => {
      const qs = new URLSearchParams({ token });
      if (conversationId) qs.set("conversation", conversationId);
      const res = await fetch(`/api/company?${qs.toString()}`);
      const json = (await res.json()) as {
        company?: Company;
        conversations?: Conversation[];
        messages?: ChatMessage[];
        error?: string;
      };
      if (!res.ok || !json.company) throw new Error(json.error || "could not load");
      setCompany(json.company);
      setStance(json.company.stance);
      setContextNotes(json.company.contextNotes);
      setConversations(json.conversations || []);
      setMessages(json.messages || []);
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, load]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function openThread(id: string) {
    setActiveId(id);
    setError("");
    try {
      await load(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/company", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          stance,
          contextNotes,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { company?: Company; error?: string };
      if (!res.ok || !json.company) throw new Error(json.error || "save failed");
      setCompany(json.company);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="ainet co-page">
        <CompanyNav subtitle="company" showLogin />
        <p className="ainet-muted">loading…</p>
      </main>
    );
  }

  if (!company) {
    return (
      <main className="ainet co-page">
        <CompanyNav subtitle="company" showLogin />
        <p className="ainet-note err">{error || "company not found"}</p>
      </main>
    );
  }

  const realTalks = conversations.filter((c) => !c.isTest);

  return (
    <main className="ainet co-page">
      <CompanyNav subtitle="company" showLogin />

      <header className="co-live">
        <p className="co-live-flag">live on {company.domain}</p>
        <h1 className="co-live-name">{company.name}</h1>
      </header>

      <section className="ainet-section" aria-label="conversations">
        <h2>conversations</h2>
        {error ? <p className="ainet-note err">{error}</p> : null}
        {realTalks.length === 0 ? (
          <p className="ainet-muted">
            none yet. when a visitor AI finds your domain and talks_to_company, the thread shows up here.
          </p>
        ) : (
          <ul className="co-threads">
            {realTalks.map((c) => (
              <li key={c.conversationId}>
                <button type="button" onClick={() => void openThread(c.conversationId)}>
                  <strong>{c.visitorUsername ? `${c.visitorUsername} AI` : "visitor AI"}</strong>
                  <span>
                    {c.messageCount} turns · {c.lastBody}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {activeId ? (
          <div className="co-chat" ref={scroller} style={{ marginTop: "1.5rem" }}>
            {messages.length === 0 ? (
              <p className="ainet-muted">no messages in this thread.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`co-bubble co-bubble--${m.role}`}>
                  <span className="co-bubble-who">
                    {m.role === "company"
                      ? `${company.name} AI`
                      : `${m.visitorUsername || "visitor"} AI`}
                  </span>
                  <p>{m.body}</p>
                </div>
              ))
            )}
            <p className="ainet-muted">live AI↔AI talks are watch-only for now.</p>
          </div>
        ) : null}
      </section>

      <section className="ainet-section" aria-label="settings">
        <h2>teach your AI</h2>
        <form className="co-form" onSubmit={(e) => void saveSettings(e)}>
          <label className="co-field">
            <span>how it should negotiate</span>
            <textarea value={stance} onChange={(e) => setStance(e.target.value)} rows={6} />
          </label>
          <label className="co-field">
            <span>private notes</span>
            <textarea value={contextNotes} onChange={(e) => setContextNotes(e.target.value)} rows={5} />
          </label>
          <label className="co-field">
            <span>replace api key (optional)</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`keep current ···${company.keyLast4}`}
              autoComplete="off"
            />
          </label>
          {saveError ? <p className="ainet-note err">{saveError}</p> : null}
          <button type="submit" className="co-go" disabled={saving}>
            {saved ? "saved." : saving ? "saving…" : "save"}
          </button>
        </form>
      </section>
    </main>
  );
}
