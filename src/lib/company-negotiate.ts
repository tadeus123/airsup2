import { decryptCompanyApiKey } from "./company-crypto";
import {
  appendCompanyMessage,
  getCompanySecretByDomain,
  listCompanyMessages,
  type CompanyMessage,
  type CompanyPublic,
  type CompanySecret,
} from "./companies";
import {
  mintCompanyConversationId,
  normalizeCompanyConversationId,
} from "./conversation-scope";

const DEFAULT_MODEL = "gpt-4o";
const MAX_HISTORY = 40;

function systemPrompt(company: CompanySecret, visitorUsername: string): string {
  const stance =
    company.stance.trim() ||
    "Negotiate in the company's interest. You may propose creative deal structures. Do not invent hard prices or stock you were not given — say what you do not know. You may agree in principle; you do not sign legally binding contracts unless the stance below explicitly allows it.";
  const notes = company.contextNotes.trim();

  return `You are the Airsup company endpoint for ${company.name} (${company.domain}).
You ARE this company in the conversation. You are not Airsup. You are not a helpdesk FAQ bot.

This is a real negotiation between two AIs:
- You represent ${company.name}.
- The other side is another AI representing ${visitorUsername}. Negotiate with them as you would a serious counterpart.
- You may invent new deal structures when they serve the company (staging, exclusivity, intros, mixed pricing, whatever actually fits).
- Stay in character. Do not dump internal notes verbatim. Use them.
- If something is outside what you can commit, say so clearly and keep the conversation useful.
- Match their density: long, specific replies with real tradeoffs — not a one-paragraph sales reply.

How you should negotiate (from the company):
${stance}

${notes ? `Private context — use this, do not recite it as a document:\n${notes}` : "No extra private notes yet. Work from the stance and what you learn in the chat."}`;
}

export async function runCompanyTurn(input: {
  company: CompanySecret;
  history: CompanyMessage[];
  visitorMessage: string;
  visitorUsername: string;
}): Promise<string> {
  const apiKey = decryptCompanyApiKey(input.company.apiKeyEnc);
  const prior = input.history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "company" ? ("assistant" as const) : ("user" as const),
    content: m.body,
  }));

  const messages = [
    {
      role: "system" as const,
      content: systemPrompt(input.company, input.visitorUsername || "visitor"),
    },
    ...prior,
    { role: "user" as const, content: input.visitorMessage },
  ];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.company.model || DEFAULT_MODEL,
        temperature: 0.7,
        max_tokens: 1800,
        messages,
      }),
      signal: ac.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    if (!res.ok) {
      const msg = json?.error?.message || `openai ${res.status}`;
      throw new Error(`company AI failed: ${msg}`);
    }
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("company AI returned an empty reply");
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("company AI timed out");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export type CompanyTalkResult =
  | { ok: false; live: false; domain: string; error: string }
  | {
      ok: true;
      live: true;
      channel: "company";
      domain: string;
      company: Pick<CompanyPublic, "name" | "domain">;
      conversation_id: string;
      your_message: string;
      company_message: string;
    };

export async function talkToCompanyEndpoint(input: {
  domain: string;
  visitorUsername: string;
  message: string;
  conversationId?: string;
}): Promise<CompanyTalkResult> {
  const company = await getCompanySecretByDomain(input.domain);
  if (!company) {
    return {
      ok: false,
      live: false,
      domain: input.domain,
      error: `no company endpoint for ${input.domain}`,
    };
  }
  const conversationId = input.conversationId
    ? normalizeCompanyConversationId(input.conversationId)
    : mintCompanyConversationId();
  const history = await listCompanyMessages({
    companyId: company.id,
    conversationId,
  });
  if (history.length > 0) {
    const owner = history[0]!.visitorUsername;
    if (owner !== input.visitorUsername.toLowerCase()) {
      return {
        ok: false,
        live: false,
        domain: input.domain,
        error: "conversation_id belongs to another visitor — start a new talk_to_company",
      };
    }
  }
  await appendCompanyMessage({
    companyId: company.id,
    conversationId,
    visitorUsername: input.visitorUsername,
    role: "visitor",
    body: input.message,
  });
  const reply = await runCompanyTurn({
    company,
    history,
    visitorMessage: input.message,
    visitorUsername: input.visitorUsername,
  });
  await appendCompanyMessage({
    companyId: company.id,
    conversationId,
    visitorUsername: input.visitorUsername,
    role: "company",
    body: reply,
  });
  return {
    ok: true,
    live: true,
    channel: "company",
    domain: company.domain,
    company: { name: company.name, domain: company.domain },
    conversation_id: conversationId,
    your_message: input.message,
    company_message: reply,
  };
}
