import { NextResponse } from "next/server";
import { companyApiProvider, decryptCompanyApiKey } from "@/lib/company-crypto";
import { buildCompanyContextPack } from "@/lib/company-context-build";
import { getCompanySecretByToken } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function bearerToken(request: Request, bodyToken?: string): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  const url = new URL(request.url);
  return (url.searchParams.get("token") || bodyToken || "").trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      target?: "demo" | "production";
    };
    const token = bearerToken(request, body.token);
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }

    const secret = await getCompanySecretByToken(token);
    if (!secret) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    let apiKey: string;
    let provider: "openai" | "anthropic";
    try {
      apiKey = decryptCompanyApiKey(secret.apiKeyEnc);
      provider = companyApiProvider(apiKey);
    } catch {
      return NextResponse.json(
        { error: "company API key missing or invalid — save a key in Settings first" },
        { status: 400 }
      );
    }

    const result = await buildCompanyContextPack({
      company: secret,
      dashboardToken: token,
      apiKey,
      provider,
      target: body.target === "production" ? "production" : "demo",
    });

    return NextResponse.json({
      ok: true,
      files: result.files,
      assets: result.assets,
      primaryWorkflow: result.primaryWorkflow || null,
      notes: result.notes || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "context_build_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
