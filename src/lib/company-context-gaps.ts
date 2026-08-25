import { hashCompanyToken } from "./company-crypto";
import {
  ingestCompanyContextFile,
  type CompanyContextAsset,
} from "./company-context";
import type { CompanySecret } from "./companies";
import { supabaseConfig, supabaseRpc } from "./users";

export type ContextGap = {
  id: string;
  key: string;
  title: string;
  reason: string;
  fieldType: "file" | "text" | "textarea";
  placeholder: string;
  accept: string;
  priority: number;
  status: "open" | "filled" | "dismissed";
  filledAssetId?: string | null;
  filledPreview?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type GapDraft = {
  key: string;
  title: string;
  reason: string;
  fieldType: "file" | "text" | "textarea";
  placeholder: string;
  accept: string;
  priority: number;
};

function tokenHash(dashboardToken: string): string {
  return hashCompanyToken(dashboardToken.trim());
}

async function gapRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const row = await supabaseRpc<T>(fn, body);
  if (row == null) throw new Error(`${fn} returned empty`);
  return row;
}

export async function listCompanyContextGaps(
  dashboardToken: string
): Promise<ContextGap[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];
  try {
    const rows = await supabaseRpc<ContextGap[] | null>("company_context_gaps_list", {
      p_token: cfg.token,
      p_token_hash: tokenHash(dashboardToken),
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function replaceCompanyContextGaps(
  dashboardToken: string,
  gaps: GapDraft[]
): Promise<ContextGap[]> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase not configured");
  const rows = await gapRpc<ContextGap[]>("company_context_gaps_replace", {
    p_token: cfg.token,
    p_token_hash: tokenHash(dashboardToken),
    p_gaps: gaps,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function fillCompanyContextGap(input: {
  dashboardToken: string;
  gapId: string;
  filledAssetId?: string | null;
  filledPreview?: string | null;
}): Promise<ContextGap> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase not configured");
  return gapRpc<ContextGap>("company_context_gap_fill", {
    p_token: cfg.token,
    p_token_hash: tokenHash(input.dashboardToken),
    p_gap_id: input.gapId,
    p_filled_asset_id: input.filledAssetId ?? null,
    p_filled_preview: input.filledPreview ?? null,
  });
}

export async function dismissCompanyContextGap(
  dashboardToken: string,
  gapId: string
): Promise<ContextGap> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase not configured");
  return gapRpc<ContextGap>("company_context_gap_dismiss", {
    p_token: cfg.token,
    p_token_hash: tokenHash(dashboardToken),
    p_gap_id: gapId,
  });
}

function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("gap scout returned no JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeGapDrafts(parsed: unknown): GapDraft[] {
  const obj = parsed as { gaps?: Array<Record<string, unknown>> };
  const list = Array.isArray(obj.gaps) ? obj.gaps : [];
  const out: GapDraft[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (out.length >= 6) break;
    const title = String(raw.title || "").trim().slice(0, 160);
    if (!title) continue;
    const keyBase = String(raw.key || title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const key = keyBase || `gap-${out.length + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ftRaw = String(raw.fieldType || raw.field_type || "file").toLowerCase();
    const fieldType =
      ftRaw === "text" || ftRaw === "textarea" ? (ftRaw as "text" | "textarea") : "file";
    out.push({
      key,
      title,
      reason: String(raw.reason || "").trim().slice(0, 400),
      fieldType,
      placeholder: String(raw.placeholder || "").trim().slice(0, 200),
      accept: String(raw.accept || "").trim().slice(0, 120),
      priority: Number(raw.priority) > 0 ? Number(raw.priority) : (out.length + 1) * 10,
    });
  }
  return out;
}

async function runGapScoutModel(input: {
  apiKey: string;
  provider: "openai" | "anthropic";
  system: string;
  user: string;
}): Promise<string> {
  if (input.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 0.2,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    if (!res.ok) throw new Error(json?.error?.message || `anthropic ${res.status}`);
    const text = json?.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n")
      .trim();
    if (!text) throw new Error("gap scout returned empty content");
    return text;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  if (!res.ok) throw new Error(json?.error?.message || `openai ${res.status}`);
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("gap scout returned empty content");
  return text;
}

/** Second pass: find the few highest-value missing inputs for the human operator. */
export async function scoutCompanyContextGaps(input: {
  company: CompanySecret;
  dashboardToken: string;
  apiKey: string;
  provider: "openai" | "anthropic";
  packFiles: Record<string, string>;
  primaryWorkflow?: string;
}): Promise<ContextGap[]> {
  const master = input.packFiles["01_MASTER_CONTEXT.md"] || "";
  const ledger = input.packFiles["06_SOURCE_LEDGER.md"] || "";
  const validation = input.packFiles["08_COMPANY_VALIDATION_QUESTIONS.md"] || "";
  const readme = input.packFiles["00_READ_ME_FIRST.md"] || "";

  const system = `You are a second-pass company endpoint auditor.
The first AI already built a full demo context package from public research.
Your job is NOT to ask endless questions. Find only the most decisive missing inputs a human operator could provide that would materially improve money / cost / time outcomes.

Rules:
- Return 3 to 6 gaps maximum. Prefer fewer if quality is high.
- Each gap must be something the human can actually upload or type now.
- Prefer concrete artifacts (sample contract, pricing sheet, capacity rules, authority matrix, NDA template, CRM export snippet) over vague essays.
- Do not request things already clearly verified in the pack.
- Do not invent fake urgency. Be selective and professional.
- fieldType must be one of: file, text, textarea.
- For file gaps, set accept to a sensible MIME/extension hint like ".pdf,.docx" or "image/*".
- Titles must be short and human-readable. Reasons must explain business value in one sentence.

Return ONLY JSON:
{"gaps":[{"key":"sample-contract","title":"Example signed-style contract","reason":"...","fieldType":"file","placeholder":"PDF or DOCX","accept":".pdf,.doc,.docx","priority":10}]}`;

  const user = `Company: ${input.company.name} (${input.company.domain})
North-star: ${input.company.mainGoal}
Primary workflow: ${input.primaryWorkflow || "(see pack)"}

--- 00_READ_ME_FIRST.md ---
${readme.slice(0, 4000)}

--- 01_MASTER_CONTEXT.md ---
${master.slice(0, 12000)}

--- 06_SOURCE_LEDGER.md ---
${ledger.slice(0, 6000)}

--- 08_COMPANY_VALIDATION_QUESTIONS.md ---
${validation.slice(0, 6000)}`;

  const raw = await runGapScoutModel({
    apiKey: input.apiKey,
    provider: input.provider,
    system,
    user,
  });
  const drafts = normalizeGapDrafts(extractJsonObject(raw));
  if (!drafts.length) {
    return replaceCompanyContextGaps(input.dashboardToken, [
      {
        key: "commercial-boundaries",
        title: "Commercial boundaries",
        reason:
          "Pricing floors, discount limits, or deal rules the public site does not make explicit.",
        fieldType: "textarea",
        placeholder: "What can the endpoint offer, refuse, or escalate?",
        accept: "",
        priority: 10,
      },
      {
        key: "sample-artifact",
        title: "One real sample document",
        reason:
          "A redacted contract, quote, or intake form makes negotiations concrete instead of generic.",
        fieldType: "file",
        placeholder: "PDF, DOCX, or image",
        accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp",
        priority: 20,
      },
      {
        key: "authority-rules",
        title: "Who must approve what",
        reason:
          "Without authority limits the endpoint either over-promises or stays uselessly vague.",
        fieldType: "textarea",
        placeholder: "What can AI decide alone vs what needs a human?",
        accept: "",
        priority: 30,
      },
    ]);
  }
  return replaceCompanyContextGaps(input.dashboardToken, drafts);
}

export async function fillGapWithUpload(input: {
  company: CompanySecret;
  dashboardToken: string;
  gap: ContextGap;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  apiKey: string | null;
  provider: "openai" | "anthropic" | null;
}): Promise<{ gap: ContextGap; asset: CompanyContextAsset }> {
  const asset = await ingestCompanyContextFile({
    dashboardToken: input.dashboardToken,
    filename: `gap/${input.gap.key}/${input.filename}`,
    mimeType: input.mimeType,
    bytes: input.bytes,
    apiKey: input.apiKey,
    provider: input.provider,
    sourceKind: "gap",
  });
  const gap = await fillCompanyContextGap({
    dashboardToken: input.dashboardToken,
    gapId: input.gap.id,
    filledAssetId: asset.id,
    filledPreview: input.filename,
  });
  return { gap, asset };
}

export async function fillGapWithText(input: {
  dashboardToken: string;
  gap: ContextGap;
  text: string;
  apiKey: string | null;
  provider: "openai" | "anthropic" | null;
}): Promise<{ gap: ContextGap; asset: CompanyContextAsset }> {
  const body = `# ${input.gap.title}\n\n${input.text.trim()}\n`;
  const asset = await ingestCompanyContextFile({
    dashboardToken: input.dashboardToken,
    filename: `gap/${input.gap.key}.md`,
    mimeType: "text/markdown",
    bytes: Buffer.from(body, "utf8"),
    apiKey: input.apiKey,
    provider: input.provider,
    sourceKind: "gap",
  });
  const gap = await fillCompanyContextGap({
    dashboardToken: input.dashboardToken,
    gapId: input.gap.id,
    filledAssetId: asset.id,
    filledPreview: input.text.trim().slice(0, 120),
  });
  return { gap, asset };
}
