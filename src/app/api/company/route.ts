import { NextResponse } from "next/server";
import {
  createCompany,
  getCompanyByToken,
  listCompanyConversations,
  listCompanyMessages,
  updateCompany,
} from "@/lib/companies";
import { logActivitySafe, newRequestId } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request, bodyToken?: string): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  const url = new URL(request.url);
  return (url.searchParams.get("token") || bodyToken || "").trim();
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      domain?: string;
      apiKey?: string;
      password?: string;
      stance?: string;
      contextNotes?: string;
    };
    const { company, token } = await createCompany({
      name: body.name || "",
      domain: body.domain || "",
      apiKey: body.apiKey || "",
      password: body.password || "",
      stance: body.stance,
      contextNotes: body.contextNotes,
    });
    const origin = new URL(request.url).origin;
    const dashboardUrl = `${origin}/company/d/${token}`;
    logActivitySafe({
      kind: "company_create",
      ok: true,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `company live ${company.domain}`,
      detail: { domain: company.domain, name: company.name },
      requestId,
    });
    return NextResponse.json({
      ok: true,
      company,
      token,
      dashboardUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create_failed";
    logActivitySafe({
      kind: "company_create",
      ok: false,
      httpStatus: 400,
      durationMs: Date.now() - started,
      summary: `company create failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const token = bearerToken(request);
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    const company = await getCompanyByToken(token);
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    const url = new URL(request.url);
    const conversationId = (url.searchParams.get("conversation") || "").trim();
    const conversations = await listCompanyConversations(token);
    const messages = conversationId
      ? await listCompanyMessages({ companyId: company.id, conversationId })
      : [];
    return NextResponse.json({
      ok: true,
      company,
      conversations,
      messages,
      conversationId: conversationId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "load_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      name?: string;
      stance?: string;
      contextNotes?: string;
      mainGoal?: string;
      apiKey?: string;
    };
    const token = bearerToken(request, body.token);
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    const company = await updateCompany({
      token,
      name: body.name,
      stance: body.stance,
      contextNotes: body.contextNotes,
      mainGoal: body.mainGoal,
      apiKey: body.apiKey,
    });
    return NextResponse.json({ ok: true, company });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
