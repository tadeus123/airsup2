"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatting, setChatting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const dashboardUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/company/d/${token}`;
  }, [token]);

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
  }, [messages.length, chatting]);

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

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || chatting) return;
    setChatting(true);
    setError("");
    setDraft("");
    setActiveId("test:owner");
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: "visitor",
        body: message,
        visitorUsername: "_owner_",
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch("/api/company/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, message, conversationId: "test:owner" }),
      });
      const json = (await res.json()) as {
        messages?: ChatMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "chat failed");
      setMessages(json.messages || []);
      await load("test:owner");
    } catch (err) {
      setDraft(message);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatting(false);
    }
  }

  async function copyLink() {
    if (!dashboardUrl) return;
    await navigator.clipboard.writeText(dashboardUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <main className="ainet co-page">
        <CompanyNav subtitle="company" />
        <p className="ainet-muted">loading…</p>
      </main>
    );
  }

  if (!company) {
    return (
      <main className="ainet co-page">
        <CompanyNav subtitle="company" />
        <p className="ainet-note err">{error || "company not found"}</p>
      </main>
    );
  }

  const realTalks = conversations.filter((c) => !c.isTest);
  const isTest = activeId === "test:owner";

  return (
    <main className="ainet co-page">
      <CompanyNav subtitle="company" />

      <header className="co-live">
        <p className="co-live-flag">live on {company.domain}</p>
        <h1 className="co-live-name">{company.name}</h1>
        <p className="ainet-muted">
          bookmark this page — it is your login. key ···{company.keyLast4}
        </p>
        <p className="ainet-actions">
          <button type="button" onClick={() => void copyLink()}>
            {copied ? "copied." : "copy dashboard link"}
          </button>
        </p>
      </header>

      <section className="ainet-section" aria-label="test talk">
        <h2>{isTest ? "test talk — play a buyer, hear your AI" : `talk with ${activeId.slice(0, 8)}…`}</h2>
        <div className="co-chat" ref={scroller}>
          {messages.length === 0 ? (
            <p className="ainet-muted">
              {isTest
                ? "say what a buyer would say. this is a real negotiation with your company AI."
                : "no messages in this thread."}
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`co-bubble co-bubble--${m.role}`}>
                <span className="co-bubble-who">
                  {m.role === "company" ? company.name : isTest ? "you as buyer" : m.visitorUsername}
                </span>
                <p>{m.body}</p>
              </div>
            ))
          )}
          {chatting ? <p className="ainet-muted">your AI is thinking…</p> : null}
        </div>
        {isTest ? (
          <form className="co-chat-form" onSubmit={(e) => void sendTest(e)}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="we need 2k units of …"
              rows={3}
              disabled={chatting}
            />
            {error ? <p className="ainet-note err">{error}</p> : null}
            <button type="submit" disabled={chatting || !draft.trim()}>
              {chatting ? "…" : "send"}
            </button>
          </form>
        ) : (
          <p className="ainet-muted">real talks are watch-only for now.</p>
        )}
      </section>

      <section className="ainet-section" aria-label="conversations">
        <h2>conversations</h2>
        {realTalks.length === 0 ? (
          <p className="ainet-muted">none yet. when a ChatGPT finds your domain, the thread shows up here.</p>
        ) : (
          <ul className="co-threads">
            {realTalks.map((c) => (
              <li key={c.conversationId}>
                <button type="button" onClick={() => void openThread(c.conversationId)}>
                  <strong>{c.visitorUsername || "visitor"}</strong>
                  <span>
                    {c.messageCount} turns · {c.lastBody}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeId !== "test:owner" ? (
          <p className="ainet-actions" style={{ marginTop: "1rem" }}>
            <button type="button" onClick={() => void openThread("test:owner")}>
              back to test talk
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
