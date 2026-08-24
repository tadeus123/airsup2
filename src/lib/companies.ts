import { randomUUID } from "node:crypto";
import {
  encryptCompanyApiKey,
  hashCompanyToken,
  mintCompanyToken,
  companyKeyLast4,
  assertOpenAiKey,
} from "./company-crypto";
import { supabaseConfig, supabaseRpc } from "./users";

export type CompanyPublic = {
  id: string;
  name: string;
  domain: string;
  tokenPrefix: string;
  keyLast4: string;
  model: string;
  stance: string;
  contextNotes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CompanySecret = CompanyPublic & {
  apiKeyEnc: string;
};

export type CompanyMessage = {
  id: number;
  conversationId: string;
  visitorUsername: string;
  role: "visitor" | "company";
  body: string;
  createdAt: string;
};

export type CompanyConversation = {
  conversationId: string;
  visitorUsername: string;
  lastRole: "visitor" | "company";
  lastBody: string;
  lastAt: string;
  messageCount: number;
  isTest: boolean;
};

type MemoryCompany = CompanySecret & { tokenHash: string };
type MemoryStore = {
  byId: Map<string, MemoryCompany>;
  byDomain: Map<string, string>;
  byHash: Map<string, string>;
  messages: CompanyMessage[];
  seq: number;
};

const memory: MemoryStore = {
  byId: new Map(),
  byDomain: new Map(),
  byHash: new Map(),
  messages: [],
  seq: 0,
};

export function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0] || "";
  s = s.split("?")[0] || "";
  s = s.split("#")[0] || "";
  s = s.replace(/:\d+$/, "");
  s = s.replace(/\.$/, "");
  return s;
}

export function assertDomain(raw: string): string {
  const domain = normalizeDomain(raw);
  if (!domain || !domain.includes(".") || domain.length < 3) {
    throw new Error("enter a real domain, e.g. acme.com");
  }
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith("-") || domain.endsWith("-")) {
    throw new Error("that domain does not look valid");
  }
  return domain;
}

function mapCompanyPublic(row: Record<string, unknown>): CompanyPublic {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    domain: String(row.domain ?? ""),
    tokenPrefix: String(row.tokenPrefix ?? row.token_prefix ?? ""),
    keyLast4: String(row.keyLast4 ?? row.key_last4 ?? ""),
    model: String(row.model ?? "gpt-4o"),
    stance: String(row.stance ?? ""),
    contextNotes: String(row.contextNotes ?? row.context_notes ?? ""),
    createdAt: row.createdAt ? String(row.createdAt) : row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapCompanySecret(row: Record<string, unknown>): CompanySecret {
  return {
    ...mapCompanyPublic(row),
    apiKeyEnc: String(row.apiKeyEnc ?? row.api_key_enc ?? ""),
  };
}

function mapMessage(row: Record<string, unknown>): CompanyMessage {
  return {
    id: Number(row.id),
    conversationId: String(row.conversationId ?? row.conversation_id ?? ""),
    visitorUsername: String(row.visitorUsername ?? row.visitor_username ?? ""),
    role: row.role === "company" ? "company" : "visitor",
    body: String(row.body ?? ""),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapConversation(row: Record<string, unknown>): CompanyConversation {
  return {
    conversationId: String(row.conversationId ?? row.conversation_id ?? ""),
    visitorUsername: String(row.visitorUsername ?? row.visitor_username ?? ""),
    lastRole: row.lastRole === "company" || row.last_role === "company" ? "company" : "visitor",
    lastBody: String(row.lastBody ?? row.last_body ?? ""),
    lastAt: String(row.lastAt ?? row.last_at ?? ""),
    messageCount: Number(row.messageCount ?? row.message_count ?? 0),
    isTest: Boolean(row.isTest ?? row.is_test),
  };
}

export async function createCompany(input: {
  name: string;
  domain: string;
  apiKey: string;
  stance?: string;
  contextNotes?: string;
}): Promise<{ company: CompanyPublic; token: string }> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("company name required");
  const domain = assertDomain(input.domain);
  const apiKey = assertOpenAiKey(input.apiKey);
  const minted = mintCompanyToken();
  const apiKeyEnc = encryptCompanyApiKey(apiKey);
  const keyLast4 = companyKeyLast4(apiKey);
  const stance = (input.stance || "").trim();
  const contextNotes = (input.contextNotes || "").trim();

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("company_create", {
      p_token: cfg.token,
      p_name: name,
      p_domain: domain,
      p_token_hash: minted.hash,
      p_token_prefix: minted.prefix,
      p_api_key_enc: apiKeyEnc,
      p_key_last4: keyLast4,
      p_stance: stance,
      p_context_notes: contextNotes,
      p_model: "gpt-4o",
    });
    if (!row?.id) throw new Error("failed to create company");
    return { company: mapCompanyPublic(row), token: minted.token };
  }

  if (memory.byDomain.has(domain)) {
    throw new Error("this domain already has an airsup endpoint");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const company: MemoryCompany = {
    id,
    name,
    domain,
    tokenPrefix: minted.prefix,
    keyLast4,
    model: "gpt-4o",
    stance,
    contextNotes,
    apiKeyEnc,
    tokenHash: minted.hash,
    createdAt: now,
    updatedAt: now,
  };
  memory.byId.set(id, company);
  memory.byDomain.set(domain, id);
  memory.byHash.set(minted.hash, id);
  return { company: { ...company }, token: minted.token };
}

export async function getCompanyByToken(token: string): Promise<CompanyPublic | null> {
  const hash = hashCompanyToken(token.trim());
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("company_get_by_token", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
    if (!row) return null;
    return mapCompanyPublic(row);
  }
  const id = memory.byHash.get(hash);
  if (!id) return null;
  const c = memory.byId.get(id);
  return c ? { ...c } : null;
}

export async function getCompanySecretByToken(token: string): Promise<CompanySecret | null> {
  const hash = hashCompanyToken(token.trim());
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("company_get_secret_by_token", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
    if (!row) return null;
    return mapCompanySecret(row);
  }
  const id = memory.byHash.get(hash);
  if (!id) return null;
  const c = memory.byId.get(id);
  return c ? { ...c } : null;
}

export async function getCompanySecretByDomain(domainRaw: string): Promise<CompanySecret | null> {
  const domain = normalizeDomain(domainRaw);
  if (!domain) return null;
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown> | null>("company_get_secret_by_domain", {
      p_token: cfg.token,
      p_domain: domain,
    });
    if (!row) return null;
    return mapCompanySecret(row);
  }
  const id = memory.byDomain.get(domain);
  if (!id) return null;
  const c = memory.byId.get(id);
  return c ? { ...c } : null;
}

export async function updateCompany(input: {
  token: string;
  name?: string;
  stance?: string;
  contextNotes?: string;
  apiKey?: string;
}): Promise<CompanyPublic> {
  const token = input.token.trim();
  const hash = hashCompanyToken(token);
  let apiKeyEnc: string | null = null;
  let keyLast4: string | null = null;
  if (input.apiKey != null && input.apiKey.trim()) {
    const apiKey = assertOpenAiKey(input.apiKey);
    apiKeyEnc = encryptCompanyApiKey(apiKey);
    keyLast4 = companyKeyLast4(apiKey);
  }

  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("company_update", {
      p_token: cfg.token,
      p_token_hash: hash,
      p_name: input.name ?? null,
      p_stance: input.stance ?? null,
      p_context_notes: input.contextNotes ?? null,
      p_api_key_enc: apiKeyEnc,
      p_key_last4: keyLast4,
    });
    if (!row?.id) throw new Error("company not found");
    return mapCompanyPublic(row);
  }

  const id = memory.byHash.get(hash);
  if (!id) throw new Error("company not found");
  const c = memory.byId.get(id);
  if (!c) throw new Error("company not found");
  if (input.name?.trim()) c.name = input.name.trim();
  if (input.stance != null) c.stance = input.stance;
  if (input.contextNotes != null) c.contextNotes = input.contextNotes;
  if (apiKeyEnc) {
    c.apiKeyEnc = apiKeyEnc;
    c.keyLast4 = keyLast4 || c.keyLast4;
  }
  c.updatedAt = new Date().toISOString();
  return { ...c };
}

export type DomainCheck = {
  domain: string;
  live: boolean;
  name: string | null;
};

export async function checkCompanyDomains(rawDomains: string[]): Promise<DomainCheck[]> {
  const normalized = rawDomains
    .map((d) => normalizeDomain(d))
    .filter(Boolean);
  const unique: string[] = [];
  for (const d of normalized) {
    if (!unique.includes(d)) unique.push(d);
  }

  const cfg = supabaseConfig();
  if (cfg) {
    const rows = await supabaseRpc<Array<Record<string, unknown>>>("company_check_domains", {
      p_token: cfg.token,
      p_domains: unique,
    });
    const list = Array.isArray(rows) ? rows : [];
    return unique.map((domain) => {
      const hit = list.find((r) => String(r.domain ?? "") === domain);
      return {
        domain,
        live: Boolean(hit?.live),
        name: hit?.name ? String(hit.name) : null,
      };
    });
  }

  return unique.map((domain) => {
    const id = memory.byDomain.get(domain);
    const c = id ? memory.byId.get(id) : undefined;
    return { domain, live: Boolean(c), name: c?.name ?? null };
  });
}

export async function appendCompanyMessage(input: {
  companyId: string;
  conversationId: string;
  visitorUsername: string;
  role: "visitor" | "company";
  body: string;
}): Promise<CompanyMessage> {
  const cfg = supabaseConfig();
  if (cfg) {
    const row = await supabaseRpc<Record<string, unknown>>("company_message_append", {
      p_token: cfg.token,
      p_company_id: input.companyId,
      p_conversation_id: input.conversationId,
      p_visitor_username: input.visitorUsername,
      p_role: input.role,
      p_body: input.body,
    });
    if (!row?.id) throw new Error("failed to store message");
    return mapMessage(row);
  }

  const msg: CompanyMessage = {
    id: ++memory.seq,
    conversationId: input.conversationId,
    visitorUsername: input.visitorUsername.toLowerCase(),
    role: input.role,
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
  };
  memory.messages.push(msg);
  memoryCompanyIds.set(msg.id, input.companyId);
  return msg;
}

const memoryCompanyIds = new Map<number, string>();

export async function listCompanyMessages(input: {
  companyId: string;
  conversationId: string;
}): Promise<CompanyMessage[]> {
  const cfg = supabaseConfig();
  if (cfg) {
    const rows = await supabaseRpc<Array<Record<string, unknown>>>("company_messages_for_talk", {
      p_token: cfg.token,
      p_company_id: input.companyId,
      p_conversation_id: input.conversationId,
    });
    return Array.isArray(rows) ? rows.map(mapMessage) : [];
  }
  return memory.messages.filter(
    (m) =>
      m.conversationId === input.conversationId &&
      memoryCompanyIds.get(m.id) === input.companyId
  );
}

export async function listCompanyConversations(token: string): Promise<CompanyConversation[]> {
  const hash = hashCompanyToken(token.trim());
  const cfg = supabaseConfig();
  if (cfg) {
    const rows = await supabaseRpc<Array<Record<string, unknown>>>("company_conversations", {
      p_token: cfg.token,
      p_token_hash: hash,
    });
    return Array.isArray(rows) ? rows.map(mapConversation) : [];
  }
  const id = memory.byHash.get(hash);
  if (!id) return [];
  const grouped = new Map<string, CompanyMessage[]>();
  for (const m of memory.messages) {
    if (memoryCompanyIds.get(m.id) !== id) continue;
    const arr = grouped.get(m.conversationId) || [];
    arr.push(m);
    grouped.set(m.conversationId, arr);
  }
  const out: CompanyConversation[] = [];
  for (const [conversationId, msgs] of grouped) {
    const last = msgs[msgs.length - 1]!;
    out.push({
      conversationId,
      visitorUsername: last.visitorUsername,
      lastRole: last.role,
      lastBody: last.body.slice(0, 280),
      lastAt: last.createdAt,
      messageCount: msgs.length,
      isTest: last.visitorUsername === "_owner_",
    });
  }
  out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  return out;
}

export const OWNER_VISITOR = "_owner_";
export const OWNER_TEST_CONVERSATION = "test:owner";
