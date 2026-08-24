import { NextResponse } from "next/server";
import { getCompanySecretByToken, listCompanyConversations } from "@/lib/companies";
import { runTadeVisitorSimulation } from "@/lib/company-negotiate";
import { logActivitySafe, newRequestId } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      turns?: number;
    };
    const token = (body.token || "").trim();
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    const company = await getCompanySecretByToken(token);
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const { conversationId, messages } = await runTadeVisitorSimulation({
      company,
      turns: body.turns,
    });
    const conversations = await listCompanyConversations(token);

    logActivitySafe({
      kind: "company_sim_chat",
      ok: true,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `tade sim ${company.domain} ${messages.length} msgs`,
      detail: { domain: company.domain, conversationId, turns: body.turns ?? 3 },
      requestId,
    });

    return NextResponse.json({
      ok: true,
      conversationId,
      messages,
      conversations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "simulate_failed";
    logActivitySafe({
      kind: "company_sim_chat",
      ok: false,
      httpStatus: 400,
      durationMs: Date.now() - started,
      summary: `tade sim failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
