import { NextResponse } from "next/server";
import { companyApiProvider, decryptCompanyApiKey } from "@/lib/company-crypto";
import {
  deleteCompanyContextAsset,
  ingestCompanyContextFile,
  listCompanyContextAssets,
} from "@/lib/company-context";
import { getCompanySecretByToken } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILE_BYTES = 2_500_000;
const MAX_FILES = 20;

function bearerToken(request: Request, bodyToken?: string): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  const url = new URL(request.url);
  return (url.searchParams.get("token") || bodyToken || "").trim();
}

export async function GET(request: Request) {
  try {
    const token = bearerToken(request);
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    const assets = await listCompanyContextAssets(token);
    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "list_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const token = bearerToken(request);
    const assetId = (url.searchParams.get("id") || "").trim();
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    if (!assetId) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await deleteCompanyContextAsset(token, assetId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delete_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const token = String(form.get("token") || bearerToken(request) || "").trim();
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }

    const secret = await getCompanySecretByToken(token);
    if (!secret) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    let apiKey: string | null = null;
    let provider: "openai" | "anthropic" | null = null;
    try {
      apiKey = decryptCompanyApiKey(secret.apiKeyEnc);
      provider = companyApiProvider(apiKey);
    } catch {
      apiKey = null;
      provider = null;
    }

    const files = form.getAll("files").filter((f): f is File => typeof File !== "undefined" && f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "no files uploaded" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `upload at most ${MAX_FILES} files at once` },
        { status: 400 }
      );
    }

    const results = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        results.push({
          filename: file.name,
          ok: false,
          error: `file too large (max ${Math.round(MAX_FILE_BYTES / 1_000_000)}MB)`,
        });
        continue;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      try {
        const asset = await ingestCompanyContextFile({
          dashboardToken: token,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: buf,
          apiKey,
          provider,
          // Bulk uploads must stay fast — chunk text, don't LLM each file.
          skipAiStructure: true,
        });
        results.push({ filename: file.name, ok: true, asset });
      } catch (e) {
        results.push({
          filename: file.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const assets = await listCompanyContextAssets(token);
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      results,
      assets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upload_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
