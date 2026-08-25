import { NextResponse } from "next/server";
import { companyApiProvider, decryptCompanyApiKey } from "@/lib/company-crypto";
import { buildCompanyContextPack } from "@/lib/company-context-build";
import { scoutCompanyContextGaps, type ContextGap } from "@/lib/company-context-gaps";
import { getCompanySecretByToken, updateCompany } from "@/lib/companies";

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

    if (result.negotiationStance) {
      await updateCompany({
        token,
        stance: result.negotiationStance,
      }).catch(() => null);
    }

    let gaps: ContextGap[] = [];
    try {
      gaps = await scoutCompanyContextGaps({
        company: secret,
        dashboardToken: token,
        apiKey,
        provider,
        packFiles: result.packFiles,
        primaryWorkflow: result.primaryWorkflow,
      });
    } catch {
      gaps = [];
    }

    const refreshed = await getCompanySecretByToken(token);

    return NextResponse.json({
      ok: true,
      files: result.files,
      assets: result.assets,
      gaps,
      primaryWorkflow: result.primaryWorkflow || null,
      notes: result.notes || null,
      company: refreshed
        ? {
            id: refreshed.id,
            name: refreshed.name,
            domain: refreshed.domain,
            keyLast4: refreshed.keyLast4,
            stance: refreshed.stance,
            contextNotes: refreshed.contextNotes,
            mainGoal: refreshed.mainGoal,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "context_build_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
