import { readFileSync } from "fs";
import { join } from "path";
import {
  deleteCompanyContextAsset,
  ingestCompanyContextFile,
  listCompanyContextAssets,
  type CompanyContextAsset,
} from "./company-context";
import type { CompanySecret } from "./companies";

export const CONTEXT_PACK_FILES = [
  "00_READ_ME_FIRST.md",
  "01_MASTER_CONTEXT.md",
  "02_ENDPOINT_CONFIG.json",
  "03_SYNTHETIC_DEMO_DATA.json",
  "04_DEMO_CONTRACTS.md",
  "05_TOOL_AND_ACTION_SCHEMA.json",
  "06_SOURCE_LEDGER.md",
  "07_LIVE_DEMO_SCRIPT.md",
  "08_COMPANY_VALIDATION_QUESTIONS.md",
] as const;

type PackFileName = (typeof CONTEXT_PACK_FILES)[number];

export type ContextBuildResult = {
  assets: CompanyContextAsset[];
  files: string[];
  primaryWorkflow?: string;
  notes?: string;
};

function loadOnboardingInstructions(): string {
  const path = join(process.cwd(), "src/lib/company-onboarding-instructions.md");
  return readFileSync(path, "utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPublicPage(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "AirsupContextBuilder/1.0 (+https://airsup.ai)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (!/text|html|xml|json/i.test(ctype) && ctype) return null;
    const raw = await res.text();
    const text = ctype.includes("json") ? raw : stripHtml(raw);
    if (text.length < 80) return null;
    return { url, text: text.slice(0, 12_000) };
  } catch {
    return null;
  }
}

async function gatherPublicResearch(domain: string): Promise<string> {
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!host) return "";
  const paths = [
    "/",
    "/about",
    "/about-us",
    "/product",
    "/products",
    "/pricing",
    "/solutions",
    "/company",
    "/imprint",
    "/impressum",
    "/legal",
    "/privacy",
    "/terms",
    "/contact",
    "/faq",
    "/docs",
  ];
  const urls = paths.flatMap((p) => [
    `https://${host}${p}`,
    `https://www.${host}${p}`,
  ]);
  const seen = new Set<string>();
  const pages: Array<{ url: string; text: string }> = [];
  for (const url of urls) {
    if (pages.length >= 8) break;
    const key = url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const page = await fetchPublicPage(url);
    if (!page) continue;
    const bodyKey = page.text.slice(0, 200);
    if (pages.some((p) => p.text.slice(0, 200) === bodyKey)) continue;
    pages.push(page);
  }
  if (!pages.length) {
    return `No public HTML could be fetched for ${host}. Rely on attributable public knowledge and mark inferences/simulations correctly.`;
  }
  return pages
    .map((p, i) => `### Source ${i + 1}: ${p.url}\n${p.text}`)
    .join("\n\n")
    .slice(0, 55_000);
}

function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("onboarding AI returned no JSON package");
  return JSON.parse(raw.slice(start, end + 1));
}

async function runSmartOnboardingModel(input: {
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
        max_tokens: 16_000,
        temperature: 0.3,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    if (!res.ok) {
      throw new Error(json?.error?.message || `anthropic ${res.status}`);
    }
    const text = json?.content
      ?.filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n")
      .trim();
    if (!text) throw new Error("onboarding AI returned empty content");
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
      temperature: 0.3,
      max_tokens: 16_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  if (!res.ok) {
    throw new Error(json?.error?.message || `openai ${res.status}`);
  }
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("onboarding AI returned empty content");
  return text;
}

function normalizePack(parsed: unknown): {
  files: Record<PackFileName, string>;
  primaryWorkflow?: string;
  notes?: string;
} {
  const obj = parsed as {
    files?: Record<string, string>;
    primary_workflow?: string;
    primaryWorkflow?: string;
    notes?: string;
    summary?: string;
  };
  const filesIn = obj.files || {};
  const files = {} as Record<PackFileName, string>;
  const missing: string[] = [];
  for (const name of CONTEXT_PACK_FILES) {
    const content = String(filesIn[name] || "").trim();
    if (!content) missing.push(name);
    else files[name] = content;
  }
  if (missing.length) {
    throw new Error(`onboarding package incomplete — missing ${missing.join(", ")}`);
  }
  return {
    files,
    primaryWorkflow: String(obj.primary_workflow || obj.primaryWorkflow || "").trim() || undefined,
    notes: String(obj.notes || obj.summary || "").trim() || undefined,
  };
}

/** Research the domain and build the numbered endpoint context pack into company knowledge. */
export async function buildCompanyContextPack(input: {
  company: CompanySecret;
  dashboardToken: string;
  apiKey: string;
  provider: "openai" | "anthropic";
  target?: "demo" | "production";
}): Promise<ContextBuildResult> {
  const instructions = loadOnboardingInstructions();
  const research = await gatherPublicResearch(input.company.domain);
  const target = input.target || "demo";

  const system = `${instructions}

---

OUTPUT CONTRACT (mandatory for this Airsup run):
Return ONLY one JSON object (no markdown fences) with this shape:
{
  "primary_workflow": "short name of chosen workflow",
  "notes": "2-6 sentences: verified highlights, main simulated assumptions, how to use the pack",
  "files": {
    "00_READ_ME_FIRST.md": "...",
    "01_MASTER_CONTEXT.md": "...",
    "02_ENDPOINT_CONFIG.json": "...",
    "03_SYNTHETIC_DEMO_DATA.json": "...",
    "04_DEMO_CONTRACTS.md": "...",
    "05_TOOL_AND_ACTION_SCHEMA.json": "...",
    "06_SOURCE_LEDGER.md": "...",
    "07_LIVE_DEMO_SCRIPT.md": "...",
    "08_COMPANY_VALIDATION_QUESTIONS.md": "..."
  }
}
Every files.* value must be a complete string. JSON files must be valid JSON text inside the string.
Follow truth-class rules. Prefer a useful demo endpoint over decorative facts.`;

  const user = `INPUT BLOCK
Company name: ${input.company.name}
Primary domain: ${input.company.domain}
Other known websites or profiles: (unknown)
Demo or production target: ${target}
Deadline: none
Known purpose of the endpoint: ${input.company.stance || "(not set — infer highest-value workflow)"}
Known counterparties: (unknown — infer)
Internal files supplied: (none beyond this research)
Available system connections: (none yet)
Known restrictions: Label SIMULATED_DEMO carefully; do not invent real customers/revenue/authority
Preferred output format: the Airsup JSON package above
North-star goal: ${input.company.mainGoal || "Make the company more money. Cut costs. Save time."}

PUBLIC RESEARCH EXTRACTS
${research}`;

  const raw = await runSmartOnboardingModel({
    apiKey: input.apiKey,
    provider: input.provider,
    system,
    user,
  });
  const pack = normalizePack(extractJsonObject(raw));

  const existing = await listCompanyContextAssets(input.dashboardToken);
  for (const asset of existing) {
    const base = asset.filename.replace(/^ai-build\//, "");
    if (
      asset.sourceKind === "ai_build" ||
      CONTEXT_PACK_FILES.includes(base as PackFileName) ||
      CONTEXT_PACK_FILES.includes(asset.filename as PackFileName)
    ) {
      await deleteCompanyContextAsset(input.dashboardToken, asset.id).catch(() => false);
    }
  }

  const created: CompanyContextAsset[] = [];
  for (const name of CONTEXT_PACK_FILES) {
    const body = pack.files[name];
    const mime = name.endsWith(".json") ? "application/json" : "text/markdown";
    const asset = await ingestCompanyContextFile({
      dashboardToken: input.dashboardToken,
      filename: `ai-build/${name}`,
      mimeType: mime,
      bytes: Buffer.from(body, "utf8"),
      apiKey: input.apiKey,
      provider: input.provider,
      sourceKind: "ai_build",
    });
    created.push(asset);
  }

  const assets = await listCompanyContextAssets(input.dashboardToken);
  return {
    assets,
    files: created.map((a) => a.filename),
    primaryWorkflow: pack.primaryWorkflow,
    notes: pack.notes,
  };
}
