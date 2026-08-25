import { NextResponse } from "next/server";
import { companyApiProvider, decryptCompanyApiKey } from "@/lib/company-crypto";
import {
  dismissCompanyContextGap,
  fillGapWithText,
  fillGapWithUpload,
  listCompanyContextGaps,
} from "@/lib/company-context-gaps";
import { listCompanyContextAssets } from "@/lib/company-context";
import { getCompanySecretByToken } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 2_500_000;

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
    const gaps = await listCompanyContextGaps(token);
    return NextResponse.json({ ok: true, gaps });
  } catch (error) {
    const message = error instanceof Error ? error.message : "list_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const token = bearerToken(request);
    const gapId = (url.searchParams.get("id") || "").trim();
    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    if (!gapId) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const gap = await dismissCompanyContextGap(token, gapId);
    const gaps = await listCompanyContextGaps(token);
    return NextResponse.json({ ok: true, gap, gaps });
  } catch (error) {
    const message = error instanceof Error ? error.message : "dismiss_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let token = "";
    let gapId = "";
    let text = "";
    let file: File | null = null;

    if (isMultipart) {
      const form = await request.formData();
      token = String(form.get("token") || bearerToken(request) || "").trim();
      gapId = String(form.get("gapId") || "").trim();
      text = String(form.get("text") || "").trim();
      const raw = form.get("file");
      if (typeof File !== "undefined" && raw instanceof File) file = raw;
    } else {
      const body = (await request.json().catch(() => ({}))) as {
        token?: string;
        gapId?: string;
        text?: string;
      };
      token = bearerToken(request, body.token);
      gapId = String(body.gapId || "").trim();
      text = String(body.text || "").trim();
    }

    if (!token.startsWith("aco_")) {
      return NextResponse.json({ error: "dashboard token required" }, { status: 401 });
    }
    if (!gapId) {
      return NextResponse.json({ error: "gapId required" }, { status: 400 });
    }

    const secret = await getCompanySecretByToken(token);
    if (!secret) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const gaps = await listCompanyContextGaps(token);
    const gap = gaps.find((g) => g.id === gapId);
    if (!gap) {
      return NextResponse.json({ error: "gap not found" }, { status: 404 });
    }
    if (gap.status === "filled") {
      return NextResponse.json({ ok: true, gap, gaps });
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

    if (gap.fieldType === "file") {
      if (!file) {
        return NextResponse.json({ error: "file required for this field" }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `file too large (max ${Math.round(MAX_FILE_BYTES / 1_000_000)}MB)` },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const filled = await fillGapWithUpload({
        company: secret,
        dashboardToken: token,
        gap,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: buf,
        apiKey,
        provider,
      });
      const nextGaps = await listCompanyContextGaps(token);
      const assets = await listCompanyContextAssets(token);
      return NextResponse.json({
        ok: true,
        gap: filled.gap,
        gaps: nextGaps,
        assets,
      });
    }

    if (!text) {
      return NextResponse.json({ error: "text required for this field" }, { status: 400 });
    }
    const filled = await fillGapWithText({
      dashboardToken: token,
      gap,
      text,
      apiKey,
      provider,
    });
    const nextGaps = await listCompanyContextGaps(token);
    const assets = await listCompanyContextAssets(token);
    return NextResponse.json({
      ok: true,
      gap: filled.gap,
      gaps: nextGaps,
      assets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fill_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
