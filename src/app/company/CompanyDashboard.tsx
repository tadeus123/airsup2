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
  mainGoal: string;
};

type ContextAsset = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: string;
  error?: string | null;
  sourceKind: string;
  createdAt: string;
  chunkCount?: number;
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

const DEFAULT_MAIN_GOAL = "Make the company more money. Cut costs. Save time.";

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function expandFiles(fileList: FileList | File[]): Promise<File[]> {
  const incoming = Array.from(fileList);
  const out: File[] = [];
  for (const file of incoming) {
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";
    if (!isZip) {
      out.push(file);
      continue;
    }
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        if (entry.name.startsWith("__MACOSX/") || entry.name.endsWith(".DS_Store")) continue;
        const blob = await entry.async("blob");
        out.push(new File([blob], entry.name, { type: blob.type || "application/octet-stream" }));
      }
    } catch {
      out.push(file);
    }
  }
  return out;
}

export default function CompanyDashboard() {
  const params = useParams();
  const token = String(params.token || "");
  const [company, setCompany] = useState<Company | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stance, setStance] = useState("");
  const [mainGoal, setMainGoal] = useState(DEFAULT_MAIN_GOAL);
  const [apiKey, setApiKey] = useState("");
  const [assets, setAssets] = useState<ContextAsset[]>([]);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");
  const [tab, setTab] = useState<Tab>("conversations");
  const scroller = useRef<HTMLDivElement>(null);
  const autoSelected = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = folderInput.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  const loadContext = useCallback(async () => {
    const res = await fetch(`/api/company/context?token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as { assets?: ContextAsset[]; error?: string };
    if (!res.ok) throw new Error(json.error || "could not load context");
    setAssets(json.assets || []);
  }, [token]);

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
      setMainGoal(json.company.mainGoal || DEFAULT_MAIN_GOAL);
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
        await loadContext().catch(() => {
          /* context optional on first paint */
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, load, loadContext]);

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
          mainGoal,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { company?: Company; error?: string };
      if (!res.ok || !json.company) throw new Error(json.error || "save failed");
      setCompany(json.company);
      setMainGoal(json.company.mainGoal || DEFAULT_MAIN_GOAL);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function buildContextWithAi() {
    setBuilding(true);
    setUploadError("");
    setBuildNote("");
    try {
      const res = await fetch("/api/company/context/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, target: "demo" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        assets?: ContextAsset[];
        files?: string[];
        primaryWorkflow?: string | null;
        notes?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "context build failed");
      setAssets(json.assets || []);
      const wf = json.primaryWorkflow ? ` Primary workflow: ${json.primaryWorkflow}.` : "";
      setBuildNote(
        `Built ${(json.files || []).length} context files.${wf}${
          json.notes ? ` ${json.notes}` : ""
        }`.trim()
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  }

  async function uploadSelected(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setUploadError("");
    try {
      const files = await expandFiles(list);
      if (!files.length) throw new Error("nothing to upload");
      const form = new FormData();
      form.set("token", token);
      for (const f of files.slice(0, 20)) form.append("files", f, f.name);
      const res = await fetch("/api/company/context", { method: "POST", body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        assets?: ContextAsset[];
        results?: Array<{ filename: string; ok: boolean; error?: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "upload failed");
      setAssets(json.assets || []);
      const failed = (json.results || []).filter((r) => !r.ok);
      if (failed.length) {
        setUploadError(
          failed.map((f) => `${f.filename}: ${f.error || "failed"}`).join(" · ")
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  }

  async function removeAsset(id: string) {
    setUploadError("");
    try {
      const res = await fetch(
        `/api/company/context?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "delete failed");
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
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
            <form
              className="co-form co-form-card co-form-card--flat"
              onSubmit={(e) => void saveSettings(e)}
            >
              <label className="co-field">
                <span>North-star goal</span>
                <textarea
                  value={mainGoal}
                  onChange={(e) => setMainGoal(e.target.value)}
                  rows={3}
                  placeholder={DEFAULT_MAIN_GOAL}
                />
                <span className="co-field-hint">
                  Default mindset for your company AI: grow revenue, cut costs, save time.
                </span>
              </label>
              <label className="co-field">
                <span>How to negotiate</span>
                <textarea
                  value={stance}
                  onChange={(e) => setStance(e.target.value)}
                  rows={6}
                />
              </label>

              <div className="co-field">
                <span>Company context</span>
                <p className="co-field-hint">
                  Upload files, folders, or zip archives — or let AI research your domain and
                  build the endpoint package (00–08) from the onboarding playbook. Knowledge
                  cards are retrieved during talks.
                </p>
                <div className="co-upload-actions">
                  <button
                    type="button"
                    className="co-upload-btn"
                    disabled={uploading || building}
                    onClick={() => void buildContextWithAi()}
                  >
                    {building ? "Building context…" : "Let AI build my context"}
                  </button>
                  <button
                    type="button"
                    className="co-upload-btn co-upload-btn--ghost"
                    disabled={uploading || building}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Upload files"}
                  </button>
                  <button
                    type="button"
                    className="co-upload-btn co-upload-btn--ghost"
                    disabled={uploading || building}
                    onClick={() => folderInput.current?.click()}
                  >
                    Upload folder
                  </button>
                </div>
                {building ? (
                  <p className="co-field-hint">
                    Fetching public pages and running a smart model — usually 1–3 minutes.
                    Keep this tab open.
                  </p>
                ) : null}
                {buildNote ? <p className="co-field-hint co-build-ok">{buildNote}</p> : null}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="*/*,.zip"
                  hidden
                  onChange={(e) => void uploadSelected(e.target.files)}
                />
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => void uploadSelected(e.target.files)}
                />
                {uploadError ? <p className="ainet-note err">{uploadError}</p> : null}
                {assets.length ? (
                  <ul className="co-asset-list">
                    {assets.map((a) => (
                      <li key={a.id}>
                        <div>
                          <strong>{a.filename}</strong>
                          <span>
                            {a.status}
                            {typeof a.chunkCount === "number" ? ` · ${a.chunkCount} cards` : ""}
                            {a.byteSize ? ` · ${formatBytes(a.byteSize)}` : ""}
                          </span>
                          {a.error ? <em>{a.error}</em> : null}
                        </div>
                        <button type="button" onClick={() => void removeAsset(a.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="co-field-hint">No context uploaded yet.</p>
                )}
              </div>

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
