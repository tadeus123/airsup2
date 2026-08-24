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
  const [activeId, setActiveId] = useState("test:owner");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stance, setStance] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [saving, setSaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (conversationId: string) => {
      const qs = new URLSearchParams({ token, conversation: conversationId });
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
        await load("test:owner");
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
  }, [messages.length, simulating]);

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

  async function runTadeSim() {
    if (simulating) return;
    setSimulating(true);
    setError("");
    setMessages([]);
    try {
      const res = await fetch("/api/company/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, turns: 3 }),
      });
      const json = (await res.json()) as {
        conversationId?: string;
        messages?: ChatMessage[];
        conversations?: Conversation[];
        error?: string;
      };
      if (!res.ok || !json.conversationId) throw new Error(json.error || "simulation failed");
      setActiveId(json.conversationId);
      setMessages(json.messages || []);
      if (json.conversations) setConversations(json.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulating(false);
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
  const isSim = activeId.startsWith("test:");

  function visitorLabel(username: string) {
    if (username === "tade" || username === "_owner_") return "tade's ChatGPT";
    return `${username} AI`;
  }

  return (
    <main className="ainet co-page">
      <CompanyNav subtitle="company" showLogin />

      <header className="co-live">
        <p className="co-live-flag">live on {company.domain}</p>
        <h1 className="co-live-name">{company.name}</h1>
      </header>

      <section className="ainet-section" aria-label="simulate visitor AI">
        <h2>
          {isSim
            ? "tade's ChatGPT × your company AI"
            : `AI↔AI thread · ${activeId.slice(0, 8)}…`}
        </h2>
        <div className="co-chat" ref={scroller}>
          {messages.length === 0 ? (
            <p className="ainet-muted">
              {isSim
                ? "this is what actually happens: tade brainstorms a project in his chatgpt (tademehl.com). that personal AI finds your domain and negotiates with your endpoint — dense context, several turns, both sides pushing their interests. run it."
                : "no messages in this thread."}
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`co-bubble co-bubble--${m.role}`}>
                <span className="co-bubble-who">
                  {m.role === "company"
                    ? `${company.name} AI`
                    : visitorLabel(m.visitorUsername)}
                </span>
                <p>{m.body}</p>
              </div>
            ))
          )}
          {simulating ? (
            <p className="ainet-muted">two AIs negotiating — this takes a minute…</p>
          ) : null}
        </div>
        {isSim ? (
          <div className="co-chat-form">
            {error ? <p className="ainet-note err">{error}</p> : null}
            <button
              type="button"
              onClick={() => void runTadeSim()}
              disabled={simulating}
            >
              {simulating ? "negotiating…" : "run tade's chatgpt against you"}
            </button>
          </div>
        ) : (
          <p className="ainet-muted">live AI↔AI talks are watch-only for now.</p>
        )}
      </section>

      <section className="ainet-section" aria-label="conversations">
        <h2>conversations</h2>
        {realTalks.length === 0 ? (
          <p className="ainet-muted">
            none yet. when another AI finds your domain and talks to your endpoint, the thread shows up here.
          </p>
        ) : (
          <ul className="co-threads">
            {realTalks.map((c) => (
              <li key={c.conversationId}>
                <button type="button" onClick={() => void openThread(c.conversationId)}>
                  <strong>{visitorLabel(c.visitorUsername)}</strong>
                  <span>
                    {c.messageCount} turns · {c.lastBody}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeId !== "test:owner" && !activeId.startsWith("test:tade:") ? (
          <p className="ainet-actions" style={{ marginTop: "1rem" }}>
            <button type="button" onClick={() => void openThread("test:owner")}>
              back to tade sim
            </button>
          </p>
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
