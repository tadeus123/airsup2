"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { CompanyLoading, CompanyPage } from "./CompanyChrome";

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

type Tab = "conversations" | "settings";

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function previewBody(body: string): string {
  return body.replace(/\s+/g, " ").replace(/\*\*/g, "").trim().slice(0, 90);
}

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
  const [tab, setTab] = useState<Tab>("conversations");
  const scroller = useRef<HTMLDivElement>(null);
  const autoSelected = useRef(false);

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

  const live = Boolean(company);

  useEffect(() => {
    if (!token || !live) return;
    const id = window.setInterval(() => {
      void load(activeId || undefined).catch(() => {
        /* keep last good state while polling */
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [token, live, activeId, load]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeId]);

  useEffect(() => {
    if (autoSelected.current) return;
    const real = conversations.filter((c) => !c.isTest);
    if (real.length === 0) return;
    autoSelected.current = true;
    const first = real[0].conversationId;
    setActiveId(first);
    void load(first).catch(() => {
      autoSelected.current = false;
    });
  }, [conversations, load]);

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
      <CompanyPage showLogin={false}>
        <CompanyLoading />
      </CompanyPage>
    );
  }

  if (!company) {
    return (
      <CompanyPage showLogin={false}>
        <main className="ainet co-dashboard">
          <p className="ainet-note err">{error || "Company not found"}</p>
        </main>
      </CompanyPage>
    );
  }

  const realTalks = conversations.filter((c) => !c.isTest);
  const active = realTalks.find((c) => c.conversationId === activeId) || null;
  const visitorLabel = active
    ? `${active.visitorUsername || "visitor"} AI`
    : "Visitor AI";

  return (
    <CompanyPage showLogin={false}>
      <main className="ainet co-dashboard">
        <header className="co-live">
          <div className="co-live-top">
            <span className="co-live-badge">
              <span className="co-live-dot" aria-hidden="true" />
              Live
            </span>
            <span className="co-live-domain">{company.domain}</span>
          </div>
          <h1 className="co-live-name">{company.name}</h1>
        </header>

        <nav className="co-tabs" role="tablist" aria-label="Dashboard">
          <button
            type="button"
            role="tab"
            id="tab-conversations"
            aria-selected={tab === "conversations"}
            aria-controls="panel-conversations"
            className={tab === "conversations" ? "on" : undefined}
            onClick={() => setTab("conversations")}
          >
            Conversations
          </button>
          <button
            type="button"
            role="tab"
            id="tab-settings"
            aria-selected={tab === "settings"}
            aria-controls="panel-settings"
            className={tab === "settings" ? "on" : undefined}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
        </nav>

        {tab === "conversations" ? (
          <section
            id="panel-conversations"
            role="tabpanel"
            aria-labelledby="tab-conversations"
            className="co-panel co-panel--flush"
          >
            {error ? <p className="ainet-note err">{error}</p> : null}
            {realTalks.length === 0 ? (
              <div className="co-empty">
                <p className="co-empty-title">No conversations yet</p>
              </div>
            ) : (
              <div className="co-inbox">
                <aside className="co-inbox-list" aria-label="Threads">
                  <ul className="co-threads">
                    {realTalks.map((c) => {
                      const on = c.conversationId === activeId;
                      return (
                        <li key={c.conversationId}>
                          <button
                            type="button"
                            className={on ? "on" : undefined}
                            onClick={() => void openThread(c.conversationId)}
                          >
                            <strong>
                              {c.visitorUsername ? `${c.visitorUsername} AI` : "Visitor AI"}
                            </strong>
                            <span className="co-thread-meta">
                              {c.messageCount}
                              {c.lastAt ? ` · ${formatTime(c.lastAt)}` : ""}
                            </span>
                            <span className="co-thread-preview">{previewBody(c.lastBody)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </aside>

                <div className="co-inbox-chat" aria-label="Chat">
                  {activeId && active ? (
                    <>
                      <header className="co-chat-head">
                        <div>
                          <strong>{visitorLabel}</strong>
                          <span> ↔ {company.name}</span>
                        </div>
                        <span className="co-chat-head-meta">{active.messageCount}</span>
                      </header>
                      <div className="co-chat" ref={scroller}>
                        {messages.map((m) => {
                          const mine = m.role === "company";
                          const who = mine
                            ? `${company.name} AI`
                            : `${m.visitorUsername || "visitor"} AI`;
                          return (
                            <div
                              key={m.id}
                              className={`co-bubble co-bubble--${m.role}${mine ? " co-bubble--mine" : ""}`}
                            >
                              <div className="co-bubble-meta">
                                <span className="co-bubble-who">{who}</span>
                                {m.createdAt ? (
                                  <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
                                ) : null}
                              </div>
                              <div className="co-bubble-body">
                                <ChatMarkdown text={m.body} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="co-chat-empty">
                      <p>Select a conversation</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {tab === "settings" ? (
          <section
            id="panel-settings"
            role="tabpanel"
            aria-labelledby="tab-settings"
            className="co-panel co-panel--flush"
          >
            <form className="co-form co-form-card co-form-card--flat" onSubmit={(e) => void saveSettings(e)}>
              <label className="co-field">
                <span>Stance</span>
                <textarea value={stance} onChange={(e) => setStance(e.target.value)} rows={6} />
              </label>
              <label className="co-field">
                <span>Notes</span>
                <textarea
                  value={contextNotes}
                  onChange={(e) => setContextNotes(e.target.value)}
                  rows={5}
                />
              </label>
              <label className="co-field">
                <span>New API key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`···${company.keyLast4}`}
                  autoComplete="off"
                />
              </label>
              {saveError ? <p className="ainet-note err">{saveError}</p> : null}
              <button type="submit" className="co-go" disabled={saving}>
                {saved ? "Saved" : saving ? "…" : "Save"}
              </button>
            </form>
          </section>
        ) : null}
      </main>
    </CompanyPage>
  );
}
