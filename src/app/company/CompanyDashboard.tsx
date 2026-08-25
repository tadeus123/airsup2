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

type ContextGap = {
  id: string;
  key: string;
  title: string;
  reason: string;
  fieldType: "file" | "text" | "textarea";
  placeholder: string;
  accept: string;
  priority: number;
  status: "open" | "filled" | "dismissed";
  filledPreview?: string | null;
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

async function readApiJson<T extends { error?: string }>(
  res: Response
): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(res.ok ? "empty response" : `request failed (${res.status})`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    if (/an error occurred/i.test(snippet) || res.status >= 500) {
      throw new Error(
        "Server timed out or rejected the upload (often too many/large files at once). Try fewer files, or retry one by one."
      );
    }
    throw new Error(snippet || `request failed (${res.status})`);
  }
}

export default function CompanyDashboard() {
  const params = useParams();
  const token = String(params.token || "");
  const [company, setCompany] = useState<Company | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mainGoal, setMainGoal] = useState(DEFAULT_MAIN_GOAL);
  const [apiKey, setApiKey] = useState("");
  const [assets, setAssets] = useState<ContextAsset[]>([]);
  const [gaps, setGaps] = useState<ContextGap[]>([]);
  const [gapDrafts, setGapDrafts] = useState<Record<string, string>>({});
  const [fillingGapId, setFillingGapId] = useState<string | null>(null);
  const [justFilled, setJustFilled] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [contextError, setContextError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [buildNote, setBuildNote] = useState("");
  const [buildProgress, setBuildProgress] = useState("");
  const [tab, setTab] = useState<Tab>("conversations");
  const scroller = useRef<HTMLDivElement>(null);
  const autoSelected = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const gapFileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const el = folderInput.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  const loadContext = useCallback(async () => {
    const [assetsRes, gapsRes] = await Promise.all([
      fetch(`/api/company/context?token=${encodeURIComponent(token)}`),
      fetch(`/api/company/context/gaps?token=${encodeURIComponent(token)}`),
    ]);
    const assetsJson = (await assetsRes.json()) as { assets?: ContextAsset[] };
    const gapsJson = (await gapsRes.json()) as { gaps?: ContextGap[] };
    if (assetsRes.ok) setAssets(assetsJson.assets || []);
    if (gapsRes.ok) setGaps(gapsJson.gaps || []);
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
          /* optional */
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
        /* keep last good state */
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
    setContextError("");
    setBuildNote("");
    setBuildProgress("Starting… researching your domain");
    const started = Date.now();
    const tick = window.setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      if (s < 25) setBuildProgress(`Researching public pages… ${s}s`);
      else if (s < 90) setBuildProgress(`Building endpoint package… ${s}s`);
      else setBuildProgress(`Finding high-value gaps… ${s}s (still working)`);
    }, 1000);
    try {
      const res = await fetch("/api/company/context/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, target: "demo" }),
      });
      const json = await readApiJson<{
        ok?: boolean;
        assets?: ContextAsset[];
        gaps?: ContextGap[];
        files?: string[];
        primaryWorkflow?: string | null;
        notes?: string | null;
        company?: Company;
        error?: string;
      }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error || "context build failed");
      setAssets(json.assets || []);
      setGaps(json.gaps || []);
      if (json.company) setCompany(json.company);
      const openCount = (json.gaps || []).filter((g) => g.status === "open").length;
      const wf = json.primaryWorkflow ? ` Primary workflow: ${json.primaryWorkflow}.` : "";
      setBuildNote(
        `Context package ready (${(json.files || []).length} files).${wf}${
          openCount
            ? ` ${openCount} optional improvement${openCount === 1 ? "" : "s"} below.`
            : ""
        }${json.notes ? ` ${json.notes}` : ""}`.trim()
      );
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearInterval(tick);
      setBuildProgress("");
      setBuilding(false);
    }
  }

  function markGapJustFilled(id: string) {
    setJustFilled((prev) => ({ ...prev, [id]: true }));
    window.setTimeout(() => {
      setJustFilled((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 1400);
  }

  async function submitGapFile(gap: ContextGap, list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setFillingGapId(gap.id);
    setContextError("");
    try {
      const form = new FormData();
      form.set("token", token);
      form.set("gapId", gap.id);
      form.append("file", file, file.name);
      const res = await fetch("/api/company/context/gaps", { method: "POST", body: form });
      const json = await readApiJson<{
        ok?: boolean;
        gaps?: ContextGap[];
        assets?: ContextAsset[];
        error?: string;
      }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error || "upload failed");
      setGaps(json.gaps || []);
      if (json.assets) setAssets(json.assets);
      markGapJustFilled(gap.id);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      setFillingGapId(null);
      const el = gapFileInputs.current[gap.id];
      if (el) el.value = "";
    }
  }

  async function submitGapText(gap: ContextGap) {
    const text = (gapDrafts[gap.id] || "").trim();
    if (!text) return;
    setFillingGapId(gap.id);
    setContextError("");
    try {
      const res = await fetch("/api/company/context/gaps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, gapId: gap.id, text }),
      });
      const json = await readApiJson<{
        ok?: boolean;
        gaps?: ContextGap[];
        assets?: ContextAsset[];
        error?: string;
      }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      setGaps(json.gaps || []);
      if (json.assets) setAssets(json.assets);
      setGapDrafts((prev) => {
        const next = { ...prev };
        delete next[gap.id];
        return next;
      });
      markGapJustFilled(gap.id);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      setFillingGapId(null);
    }
  }

  async function skipGap(gap: ContextGap) {
    setContextError("");
    try {
      const res = await fetch(
        `/api/company/context/gaps?token=${encodeURIComponent(token)}&id=${encodeURIComponent(gap.id)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { gaps?: ContextGap[]; error?: string };
      if (!res.ok) throw new Error(json.error || "could not skip");
      setGaps(json.gaps || []);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    }
  }

  async function uploadSelected(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setContextError("");
    setBuildNote("");
    try {
      const files = await expandFiles(list);
      if (!files.length) throw new Error("nothing to upload");
      const batch = files.slice(0, 20);
      let okCount = 0;
      const failures: string[] = [];
      let latestAssets: ContextAsset[] | null = null;

      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const short = file.name.split(/[/\\]/).pop() || file.name;
        setUploadProgress(`Uploading ${i + 1}/${batch.length} · ${short}`);
        if (file.size > 2_500_000) {
          failures.push(`${short}: too large (max ~2.5MB)`);
          continue;
        }
        const form = new FormData();
        form.set("token", token);
        form.append("files", file, file.name);
        const res = await fetch("/api/company/context", { method: "POST", body: form });
        const json = await readApiJson<{
          ok?: boolean;
          assets?: ContextAsset[];
          results?: Array<{ filename: string; ok: boolean; error?: string }>;
          error?: string;
        }>(res);
        if (!res.ok && !json.results?.length) {
          failures.push(`${short}: ${json.error || `failed (${res.status})`}`);
          continue;
        }
        if (json.assets) latestAssets = json.assets;
        for (const r of json.results || []) {
          if (r.ok) okCount += 1;
          else failures.push(`${r.filename}: ${r.error || "failed"}`);
        }
      }

      if (latestAssets) setAssets(latestAssets);
      else await loadContext().catch(() => undefined);

      if (failures.length) {
        setContextError(failures.join(" · "));
      }
      if (okCount) {
        setBuildNote(
          `Added ${okCount} file${okCount === 1 ? "" : "s"} to company knowledge.${
            failures.length ? ` ${failures.length} failed — see error above.` : ""
          }`
        );
      } else if (!failures.length) {
        throw new Error("upload failed");
      }
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setUploadProgress("");
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  }

  async function removeAsset(id: string) {
    setContextError("");
    try {
      const res = await fetch(
        `/api/company/context?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "delete failed");
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
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
  const packReady = assets.some(
    (a) => a.sourceKind === "ai_build" || a.filename.startsWith("ai-build/")
  );
  const openGaps = gaps.filter((g) => g.status === "open" || justFilled[g.id]);
  const filledGaps = gaps.filter((g) => g.status === "filled" && !justFilled[g.id]);
  const manualAssets = assets.filter(
    (a) =>
      a.sourceKind !== "ai_build" &&
      !a.filename.startsWith("ai-build/") &&
      a.sourceKind !== "gap" &&
      !a.filename.startsWith("gap/")
  );

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
                  Always optimize for this: more revenue, lower costs, less wasted time.
                </span>
              </label>

              <div className="co-field">
                <span>Endpoint context</span>
                <p className="co-field-hint">
                  Let AI research your domain and build the package, or upload internal files
                  that are not public. Both land in the same knowledge store. After an AI build,
                  adaptive cards ask only for the highest-value missing pieces — optional.
                </p>
                <div className="co-upload-actions">
                  <button
                    type="button"
                    className="co-upload-btn"
                    disabled={building || uploading}
                    onClick={() => void buildContextWithAi()}
                  >
                    {building
                      ? "Building context…"
                      : packReady
                        ? "Rebuild context"
                        : "Let AI build my context"}
                  </button>
                  <button
                    type="button"
                    className="co-upload-btn co-upload-btn--ghost"
                    disabled={building || uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Upload files"}
                  </button>
                  <button
                    type="button"
                    className="co-upload-btn co-upload-btn--ghost"
                    disabled={building || uploading}
                    onClick={() => folderInput.current?.click()}
                  >
                    Upload folder
                  </button>
                </div>
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
                {building || uploading ? (
                  <p className="co-progress" role="status" aria-live="polite">
                    <span className="co-progress-spin" aria-hidden="true" />
                    {building
                      ? buildProgress || "Building context…"
                      : uploadProgress || "Uploading…"}
                  </p>
                ) : null}
                {buildNote ? <p className="co-field-hint co-build-ok">{buildNote}</p> : null}
                {packReady && !building ? (
                  <p className="co-context-ready">
                    Context package ready
                    {filledGaps.length
                      ? ` · ${filledGaps.length} improvement${filledGaps.length === 1 ? "" : "s"} added`
                      : ""}
                    {manualAssets.length
                      ? ` · ${manualAssets.length} uploaded file${manualAssets.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                ) : null}
                {contextError ? <p className="ainet-note err">{contextError}</p> : null}

                {manualAssets.length ? (
                  <ul className="co-asset-list">
                    {manualAssets.map((a) => (
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
                ) : null}

                {openGaps.length ? (
                  <div className="co-gap-list" aria-label="Suggested improvements">
                    {openGaps.map((gap) => {
                      const done = gap.status === "filled" || justFilled[gap.id];
                      const busy = fillingGapId === gap.id;
                      return (
                        <article
                          key={gap.id}
                          className={`co-gap-card${done ? " co-gap-card--done" : ""}`}
                        >
                          <header className="co-gap-head">
                            <div>
                              <h3>{gap.title}</h3>
                              {gap.reason ? <p>{gap.reason}</p> : null}
                            </div>
                            {!done ? (
                              <button
                                type="button"
                                className="co-gap-skip"
                                onClick={() => void skipGap(gap)}
                              >
                                Skip
                              </button>
                            ) : (
                              <span className="co-gap-done-label">Added</span>
                            )}
                          </header>

                          {done ? (
                            <p className="co-gap-filled-preview">
                              {gap.filledPreview || "Saved to company knowledge"}
                            </p>
                          ) : gap.fieldType === "file" ? (
                            <div className="co-gap-drop">
                              <input
                                ref={(el) => {
                                  gapFileInputs.current[gap.id] = el;
                                }}
                                type="file"
                                accept={gap.accept || undefined}
                                hidden
                                onChange={(e) => void submitGapFile(gap, e.target.files)}
                              />
                              <button
                                type="button"
                                className="co-gap-file-btn"
                                disabled={busy}
                                onClick={() => gapFileInputs.current[gap.id]?.click()}
                              >
                                {busy ? "Uploading…" : gap.placeholder || "Choose file"}
                              </button>
                            </div>
                          ) : (
                            <div className="co-gap-text">
                              {gap.fieldType === "textarea" ? (
                                <textarea
                                  rows={4}
                                  value={gapDrafts[gap.id] || ""}
                                  placeholder={gap.placeholder || "Add the missing detail"}
                                  onChange={(e) =>
                                    setGapDrafts((prev) => ({
                                      ...prev,
                                      [gap.id]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={gapDrafts[gap.id] || ""}
                                  placeholder={gap.placeholder || "Add the missing detail"}
                                  onChange={(e) =>
                                    setGapDrafts((prev) => ({
                                      ...prev,
                                      [gap.id]: e.target.value,
                                    }))
                                  }
                                />
                              )}
                              <button
                                type="button"
                                className="co-upload-btn"
                                disabled={busy || !(gapDrafts[gap.id] || "").trim()}
                                onClick={() => void submitGapText(gap)}
                              >
                                {busy ? "Saving…" : "Add"}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : packReady ? (
                  <p className="co-field-hint">
                    No open gaps right now. Upload internal files anytime, or rebuild if the
                    business changed.
                  </p>
                ) : (
                  <p className="co-field-hint">
                    Start with AI build, upload internal files, or both. Adaptive fields appear
                    after the first build.
                  </p>
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
