import { NextResponse } from "next/server";
import { formatFailuresList, listFailures } from "@/lib/airsup-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/failures?hours=48&limit=50
 * Auth: AIRSUP_DB_TOKEN via ?token= or Authorization: Bearer
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const header = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() || "";
  const token = (url.searchParams.get("token") || bearer || "").trim();
  const expected = (process.env.AIRSUP_DB_TOKEN || "").trim();
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hours = Math.min(
    168,
    Math.max(1, Number(url.searchParams.get("hours") || 48) || 48)
  );
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") || 50) || 50)
  );

  try {
    const report = await listFailures({ hours, limit });
    const lines = formatFailuresList(report);
    return NextResponse.json({
      ...report,
      lines,
      asked: "what is failing?",
      hint: lines.length
        ? "Fix top items first; re-check with the same URL."
        : "No open failures in this window.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
