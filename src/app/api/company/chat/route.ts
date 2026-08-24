import { NextResponse } from "next/server";
import {
  OWNER_TEST_CONVERSATION,
  OWNER_VISITOR,
  appendCompanyMessage,
  getCompanySecretByToken,
  listCompanyMessages,
} from "@/lib/companies";
import { runCompanyTurn } from "@/lib/company-negotiate";
import { logActivitySafe, newRequestId } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      message?: string;
      conversationId?: string;
    };
    const token = (body.token || "").trim();
    const message = (body.message || "").trim();
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    if (!message) {
      return NextResponse.json({ error: "say something to your AI" }, { status: 400 });
    }
    const company = await getCompanySecretByToken(token);
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    const conversationId = (body.conversationId || "").trim() || OWNER_TEST_CONVERSATION;
    const history = await listCompanyMessages({
      companyId: company.id,
      conversationId,
    });
    await appendCompanyMessage({
      companyId: company.id,
      conversationId,
      visitorUsername: OWNER_VISITOR,
      role: "visitor",
      body: message,
    });
    const reply = await runCompanyTurn({
      company,
      history,
      visitorMessage: message,
      visitorUsername: OWNER_VISITOR,
    });
    const stored = await appendCompanyMessage({
      companyId: company.id,
      conversationId,
      visitorUsername: OWNER_VISITOR,
      role: "company",
      body: reply,
    });
    const messages = await listCompanyMessages({
      companyId: company.id,
      conversationId,
    });
    logActivitySafe({
      kind: "company_test_chat",
      ok: true,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `owner test ${company.domain}`,
      detail: { domain: company.domain, conversationId },
      requestId,
    });
    return NextResponse.json({
      ok: true,
      conversationId,
      reply: stored,
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "chat_failed";
    logActivitySafe({
      kind: "company_test_chat",
      ok: false,
      httpStatus: 400,
      durationMs: Date.now() - started,
      summary: `owner test failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
