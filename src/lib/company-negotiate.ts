import { decryptCompanyApiKey } from "./company-crypto";
import {
  OWNER_VISITOR,
  appendCompanyMessage,
  getCompanySecretByDomain,
  listCompanyMessages,
  type CompanyMessage,
  type CompanyPublic,
  type CompanySecret,
} from "./companies";
import { randomUUID } from "node:crypto";

const DEFAULT_MODEL = "gpt-4o";
const MAX_HISTORY = 40;

/** Personal visitor AI used in owner simulations — Tade's ChatGPT. */
export const SIM_VISITOR = "tade";
export const SIM_CONVERSATION_PREFIX = "test:tade:";

const TADE_VISITOR_CONTEXT = `You are the personal ChatGPT account of Tade Mehl (tademehl.com) — founder/builder working on robotics, startups, and products people love. You already hold a long private brainstorming thread with him: product concepts, constraints, budget bands, timelines, what he will not compromise on.

You found this company on the web and are now talking to their Airsup company endpoint (another AI). This is AI↔AI negotiation — dense, fast, high-context. Not a human typing short polite emails.

Always invent a concrete project Tade just brainstormed with you that would realistically need THIS specific company (use their name, domain, and whatever you learn). Push Tade's interests hard: price, lead time, MOQ, quality bar, IP, exclusivity, next steps. Ask for numbers. Counter-propose. Do not be vague or brochure-y.`;

function systemPrompt(company: CompanySecret, visitorUsername: string, isOwnerTest: boolean): string {
  const stance =
    company.stance.trim() ||
    "Negotiate in the company's interest. You may propose creative deal structures. Do not invent hard prices or stock you were not given — say what you do not know. You may agree in principle; you do not sign legally binding contracts unless the stance below explicitly allows it.";
  const notes = company.contextNotes.trim();
  const testLine =
    visitorUsername === SIM_VISITOR || isOwnerTest
      ? "The other side is a personal ChatGPT (visitor AI) representing a founder who found you on the web — dense context, multi-turn, pushing their project. Negotiate as you would a serious AI counterpart, not a human small-talking."
      : `The other side is another AI representing ${visitorUsername}. Negotiate with them as you would a serious counterpart.`;

  return `You are the Airsup company endpoint for ${company.name} (${company.domain}).
You ARE this company in the conversation. You are not Airsup. You are not a helpdesk FAQ bot.

This is a real negotiation between two AIs:
- You represent ${company.name}.
- ${testLine}
- You may invent new deal structures when they serve the company (staging, exclusivity, intros, mixed pricing, whatever actually fits).
- Stay in character. Do not dump internal notes verbatim. Use them.
- If something is outside what you can commit, say so clearly and keep the conversation useful.
- Match their density: long, specific replies with real tradeoffs — not a one-paragraph sales reply.

How you should negotiate (from the company):
${stance}

${notes ? `Private context — use this, do not recite it as a document:\n${notes}` : "No extra private notes yet. Work from the stance and what you learn in the chat."}`;
}

function visitorSystemPrompt(company: CompanySecret): string {
  return `${TADE_VISITOR_CONTEXT}

Company endpoint you are talking to:
- Name: ${company.name}
- Domain: ${company.domain}
- What you already scraped / know publicly about how they negotiate (may be incomplete): ${company.stance.trim() || "(unknown)"}
- Any public-ish notes you inferred: ${company.contextNotes.trim() || "(none)"}

Your job each turn: advance Tade's project. Bring more of the brainstormed context into the thread when useful. Both sides should fight for their interests.`;
}

async function openAiChat(input: {
  apiKey: string;
  model: string;
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: input.system },
    ...input.history,
  ];
  if (input.userMessage) {
    messages.push({ role: "user", content: input.userMessage });
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model || DEFAULT_MODEL,
        temperature: input.temperature ?? 0.75,
        max_tokens: input.maxTokens ?? 1800,
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
      throw new Error(`AI failed: ${msg}`);
    }
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("AI returned an empty reply");
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("AI timed out");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function runCompanyTurn(input: {
  company: CompanySecret;
  history: CompanyMessage[];
  visitorMessage: string;
  visitorUsername: string;
}): Promise<string> {
  const apiKey = decryptCompanyApiKey(input.company.apiKeyEnc);
  const isOwnerTest = input.visitorUsername === OWNER_VISITOR;
  const prior = input.history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "company" ? ("assistant" as const) : ("user" as const),
    content: m.body,
  }));

  return openAiChat({
    apiKey,
    model: input.company.model || DEFAULT_MODEL,
    system: systemPrompt(input.company, input.visitorUsername, isOwnerTest),
    history: prior,
    userMessage: input.visitorMessage,
    temperature: 0.7,
    maxTokens: 1800,
  });
}

export async function runVisitorTurn(input: {
  company: CompanySecret;
  history: CompanyMessage[];
  cue: string;
}): Promise<string> {
  const apiKey = decryptCompanyApiKey(input.company.apiKeyEnc);
  const prior = input.history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "visitor" ? ("assistant" as const) : ("user" as const),
    content: m.body,
  }));

  return openAiChat({
    apiKey,
    model: input.company.model || DEFAULT_MODEL,
    system: visitorSystemPrompt(input.company),
    history: prior,
    userMessage: input.cue,
    temperature: 0.85,
    maxTokens: 2200,
  });
}

export async function runTadeVisitorSimulation(input: {
  company: CompanySecret;
  turns?: number;
}): Promise<{ conversationId: string; messages: CompanyMessage[] }> {
  const turns = Math.min(5, Math.max(2, input.turns ?? 3));
  const conversationId = `${SIM_CONVERSATION_PREFIX}${randomUUID().slice(0, 8)}`;
  let history: CompanyMessage[] = [];

  for (let i = 0; i < turns; i++) {
    const cue =
      i === 0
        ? `Open the negotiation. Invent the concrete project Tade brainstormed with you that makes contacting ${input.company.name} (${input.company.domain}) the obvious next step. Include: what the project is, why this supplier, quantities/timeline/budget band if relevant, constraints, and what a good outcome looks like for Tade. Write as one dense visitor-AI message (several short paragraphs / bullets ok). Do not greet like a human cold email.`
        : `Continue the negotiation (turn ${i + 1} of ${turns}). Use what ${input.company.name} just said. Push Tade's interests: tighten numbers, challenge vague claims, propose a structure, ask for the next concrete commitment. Stay dense. If the deal is almost there, drive toward a clear next step (quote, sample, call with founder, MOQ trial).`;

    const visitorText = await runVisitorTurn({
      company: input.company,
      history,
      cue,
    });
    const visitorMsg = await appendCompanyMessage({
      companyId: input.company.id,
      conversationId,
      visitorUsername: SIM_VISITOR,
      role: "visitor",
      body: visitorText,
    });
    history = [...history, visitorMsg];

    const companyText = await runCompanyTurn({
      company: input.company,
      history: history.slice(0, -1),
      visitorMessage: visitorText,
      visitorUsername: SIM_VISITOR,
    });
    const companyMsg = await appendCompanyMessage({
      companyId: input.company.id,
      conversationId,
      visitorUsername: SIM_VISITOR,
      role: "company",
      body: companyText,
    });
    history = [...history, companyMsg];
  }

  return {
    conversationId,
    messages: await listCompanyMessages({
      companyId: input.company.id,
      conversationId,
    }),
  };
}

export type CompanyTalkResult =
  | { ok: false; live: false; domain: string; error: string }
  | {
      ok: true;
      live: true;
      domain: string;
      company: Pick<CompanyPublic, "name" | "domain">;
      conversationId: string;
      message: string;
      reply: string;
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
  const conversationId = (input.conversationId || "").trim() || randomUUID();
  const history = await listCompanyMessages({
    companyId: company.id,
    conversationId,
  });
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
    domain: company.domain,
    company: { name: company.name, domain: company.domain },
    conversationId,
    message: input.message,
    reply,
  };
}
