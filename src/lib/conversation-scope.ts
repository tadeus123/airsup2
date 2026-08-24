import { randomUUID } from "node:crypto";

/** Company negotiation threads use this prefix so they never collide with peer UUIDs. */
export const COMPANY_CONV_PREFIX = "co:";

export function looksLikeDomain(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/^@+/, "");
  const host = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
  if (!host.includes(".")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\.[a-z]{2,}$/i.test(
    host
  );
}

export function isCompanyConversationId(id: string): boolean {
  return (id || "").trim().startsWith(COMPANY_CONV_PREFIX);
}

export function isPeerConversationId(id: string): boolean {
  const cid = (id || "").trim();
  if (!cid) return false;
  if (isCompanyConversationId(cid)) return false;
  if (/^#\d+$/.test(cid)) return true;
  if (looksLikeDomain(cid)) return false;
  return true;
}

export function mintCompanyConversationId(): string {
  return `${COMPANY_CONV_PREFIX}${randomUUID()}`;
}

/** Normalize company conversation_id from talk_to_company (must use co: prefix). */
export function normalizeCompanyConversationId(raw: string): string {
  const cid = raw.trim();
  if (!cid.startsWith(COMPANY_CONV_PREFIX)) {
    throw new Error(
      `invalid company conversation_id — pass the ${COMPANY_CONV_PREFIX}… value returned by talk_to_company, not a peer thread id`
    );
  }
  return cid;
}

export function companyConversationGuard(conversationId: string | undefined): string | null {
  const cid = (conversationId || "").trim();
  if (!cid) return null;
  if (!cid.startsWith(COMPANY_CONV_PREFIX)) {
    return `conversation_id "${cid}" is a peer thread id. Use talk_to_user / await_reply for people — talk_to_company only accepts ${COMPANY_CONV_PREFIX}… ids.`;
  }
  if (looksLikeDomain(cid.slice(COMPANY_CONV_PREFIX.length))) {
    return `"${cid}" is not a valid company conversation_id.`;
  }
  return null;
}

export function peerConversationGuard(
  conversationId: string | undefined,
  toolName: string
): string | null {
  const cid = (conversationId || "").trim();
  if (!cid) return null;
  if (isCompanyConversationId(cid)) {
    return `conversation_id "${cid}" is a company negotiation. Use talk_to_company — not ${toolName}.`;
  }
  if (looksLikeDomain(cid)) {
    return `"${cid}" looks like a domain. Use talk_to_company with domain= — not ${toolName}.`;
  }
  return null;
}

export function companyDomainGuard(raw: string, toolName: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (looksLikeDomain(s)) {
    return `"${s}" is a company domain. Use talk_to_company — not ${toolName}.`;
  }
  return null;
}
