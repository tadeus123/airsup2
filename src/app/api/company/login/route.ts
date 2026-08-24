import { NextResponse } from "next/server";
import { loginCompany } from "@/lib/companies";
import { logActivitySafe, newRequestId } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      password?: string;
    };
    const { company, token } = await loginCompany({
      domain: body.domain || "",
      password: body.password || "",
    });
    const origin = new URL(request.url).origin;
    const dashboardUrl = `${origin}/company/d/${token}`;
    logActivitySafe({
      kind: "company_login",
      ok: true,
      httpStatus: 200,
      durationMs: Date.now() - started,
      summary: `company login ${company.domain}`,
      detail: { domain: company.domain },
      requestId,
    });
    return NextResponse.json({
      ok: true,
      company: { name: company.name, domain: company.domain },
      token,
      dashboardUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "login_failed";
    logActivitySafe({
      kind: "company_login",
      ok: false,
      httpStatus: 401,
      durationMs: Date.now() - started,
      summary: `company login failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
