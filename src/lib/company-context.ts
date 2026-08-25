import { hashCompanyToken } from "./company-crypto";
import { supabaseConfig, supabaseRpc } from "./users";

export type CompanyContextAsset = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: "processing" | "ready" | "failed";
  error?: string | null;
  sourceKind: string;
  createdAt: string;
  chunkCount?: number;
};

export type CompanyContextChunk = {
  id: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  createdAt?: string;
};

async function ctxRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const row = await supabaseRpc<T>(fn, body);
  if (row == null) throw new Error(`${fn} returned empty`);
  return row;
}

function tokenHash(dashboardToken: string): string {
  return hashCompanyToken(dashboardToken.trim());
}

export async function listCompanyContextAssets(
  dashboardToken: string
): Promise<CompanyContextAsset[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];
  try {
    const rows = await supabaseRpc<CompanyContextAsset[] | null>("company_context_list", {
      p_token: cfg.token,
      p_token_hash: tokenHash(dashboardToken),
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function deleteCompanyContextAsset(
  dashboardToken: string,
  assetId: string
): Promise<boolean> {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  return Boolean(
    await ctxRpc<boolean>("company_context_delete_asset", {
      p_token: cfg.token,
      p_token_hash: tokenHash(dashboardToken),
      p_asset_id: assetId,
    })
  );
}

export async function retrieveCompanyContext(input: {
  domain: string;
  query: string;
  limit?: number;
}): Promise<CompanyContextChunk[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];
  try {
    const rows = await supabaseRpc<CompanyContextChunk[] | null>("company_context_retrieve", {
      p_token: cfg.token,
      p_domain: input.domain,
      p_query: input.query,
      p_limit: input.limit ?? 8,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function sourceKindFor(filename: string, mime: string): string {
  const lower = filename.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) {
    return "image";
  }
  if (lower.endsWith(".zip") || mime.includes("zip")) return "zip";
  if (filename.includes("/")) return "folder";
  return "file";
}

function isProbablyText(mime: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime.includes("csv")
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|yml|yaml|toml|ini|env|log|sql|rtf)$/i.test(
    lower
  );
}

function extractKeywords(text: string, filename: string): string[] {
  const base = filename
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  const words = `${base || ""} ${text}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && w.length <= 32);
  const stop = new Set([
    "that",
    "this",
    "with",
    "from",
    "have",
    "will",
    "your",
    "about",
    "their",
    "there",
    "would",
    "could",
    "should",
    "which",
    "while",
    "where",
    "when",
    "been",
    "were",
    "they",
    "them",
    "then",
    "than",
    "also",
    "into",
    "over",
    "such",
    "only",
    "other",
    "more",
    "most",
    "some",
    "what",
    "make",
    "company",
  ]);
  const counts = new Map<string, number>();
  for (const w of words) {
    if (stop.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([w]) => w);
}

function chunkText(text: string, max = 2800): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= max) return [cleaned];
  const parts: string[] = [];
  let i = 0;
  while (i < cleaned.length && parts.length < 12) {
    let end = Math.min(cleaned.length, i + max);
    if (end < cleaned.length) {
      const slice = cleaned.slice(i, end);
      const breakAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (breakAt > max * 0.4) end = i + breakAt + 1;
    }
    const piece = cleaned.slice(i, end).trim();
    if (piece) parts.push(piece);
    i = end;
  }
  return parts;
}

async function structureWithCompanyAi(input: {
  apiKey: string;
  provider: "openai" | "anthropic";
  filename: string;
  text: string;
}): Promise<Array<{ title: string; summary: string; body: string; keywords: string[] }> | null> {
  const sample = input.text.slice(0, 10000);
  const prompt = `Turn this uploaded company file into compact knowledge cards for a negotiating AI.
Return ONLY JSON: {"cards":[{"title":"...","summary":"...","body":"...","keywords":["..."]}]}
Max 4 cards. Body <= 1200 chars each. Focus on facts, offers, pricing, constraints, customers, products, policies — anything useful to make money, cut costs, or save time.

Filename: ${input.filename}
Content:
${sample}`;

  try {
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
          max_tokens: 1800,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as {
        content?: Array<{ text?: string }>;
      };
      const raw = json.content?.map((c) => c.text || "").join("\n") || "";
      return parseCards(raw);
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseCards(json.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}

function parseCards(
  raw: string
): Array<{ title: string; summary: string; body: string; keywords: string[] }> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      cards?: Array<{
        title?: string;
        summary?: string;
        body?: string;
        keywords?: string[];
      }>;
    };
    const cards = (parsed.cards || [])
      .map((c) => ({
        title: String(c.title || "").trim().slice(0, 200),
        summary: String(c.summary || "").trim().slice(0, 800),
        body: String(c.body || "").trim().slice(0, 4000),
        keywords: Array.isArray(c.keywords)
          ? c.keywords.map((k) => String(k).toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12)
          : [],
      }))
      .filter((c) => c.body);
    return cards.length ? cards : null;
  } catch {
    return null;
  }
}

/** Ingest one uploaded file into company knowledge chunks. */
export async function ingestCompanyContextFile(input: {
  dashboardToken: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  apiKey?: string | null;
  provider?: "openai" | "anthropic" | null;
  sourceKind?: string;
  /** Skip per-file LLM structuring — use fast text chunking (preferred for bulk upload). */
  skipAiStructure?: boolean;
}): Promise<CompanyContextAsset> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase not configured");

  const filename = input.filename.trim().slice(0, 400) || "upload";
  const mime = input.mimeType || "application/octet-stream";
  const kind = input.sourceKind?.trim() || sourceKindFor(filename, mime);
  const hash = tokenHash(input.dashboardToken);

  const asset = await ctxRpc<{
    id: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    status: string;
    sourceKind: string;
    createdAt: string;
  }>("company_context_asset_add", {
    p_token: cfg.token,
    p_token_hash: hash,
    p_filename: filename,
    p_mime_type: mime,
    p_byte_size: input.bytes.length,
    p_source_kind: kind,
    p_status: "processing",
  });
  if (!asset?.id) throw new Error("failed to register context file");

  try {
    let cards: Array<{ title: string; summary: string; body: string; keywords: string[] }> = [];

    if (isProbablyText(mime, filename)) {
      const text = input.bytes.toString("utf8");
      const skipStructure =
        input.skipAiStructure === true || kind === "ai_build" || kind === "gap";
      if (!skipStructure && input.apiKey && input.provider) {
        const structured = await structureWithCompanyAi({
          apiKey: input.apiKey,
          provider: input.provider,
          filename,
          text,
        });
        if (structured?.length) cards = structured;
      }
      if (!cards.length) {
        const pieces = chunkText(text, kind === "ai_build" ? 3500 : 2800);
        cards = pieces.map((body, i) => ({
          title: `${filename.replace(/^(ai-build|gap)\//, "")}${pieces.length > 1 ? ` (${i + 1})` : ""}`,
          summary: body.slice(0, 220).replace(/\s+/g, " "),
          body,
          keywords: extractKeywords(body, filename),
        }));
      }
    } else if (kind === "image") {
      cards = [
        {
          title: `Image: ${filename}`,
          summary: "Uploaded image asset available as company context reference.",
          body: `Image file "${filename}" (${mime}, ${input.bytes.length} bytes) was uploaded as company context. Use it as evidence that this visual asset exists; ask for clarification if pixel-level detail is required.`,
          keywords: extractKeywords(filename, filename),
        },
      ];
    } else {
      cards = [
        {
          title: `File: ${filename}`,
          summary: "Binary/other file registered as company context.",
          body: `File "${filename}" (${mime}, ${input.bytes.length} bytes) was uploaded. Text could not be extracted automatically. Prefer asking the human for a text export if this file is critical.`,
          keywords: extractKeywords(filename, filename),
        },
      ];
    }

    for (const card of cards) {
      await ctxRpc("company_context_chunk_add", {
        p_token: cfg.token,
        p_token_hash: hash,
        p_asset_id: asset.id,
        p_title: card.title,
        p_summary: card.summary,
        p_body: card.body,
        p_keywords: card.keywords,
      });
    }

    const finished = await ctxRpc<CompanyContextAsset>("company_context_asset_finish", {
      p_token: cfg.token,
      p_token_hash: hash,
      p_asset_id: asset.id,
      p_status: "ready",
      p_error: null,
    });
    return {
      ...finished,
      chunkCount: cards.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctxRpc("company_context_asset_finish", {
      p_token: cfg.token,
      p_token_hash: hash,
      p_asset_id: asset.id,
      p_status: "failed",
      p_error: msg.slice(0, 240),
    }).catch(() => {});
    throw e;
  }
}
