import { NextResponse } from "next/server";
import {
  claimStalePortalComputer,
  cleanupStalePortalComputers,
  listOrgoWorkspaceComputers,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { listLinkedOrgoComputerIds } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function opsAuthorized(request: Request): boolean {
  const secret = (process.env.AIRSUP_DB_TOKEN || "").trim();
  if (!secret) return false;
  const url = new URL(request.url);
  const q = (url.searchParams.get("token") || "").trim();
  const h = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return q === secret || h === secret;
}

/** Ops: inspect / reclaim Orgo capacity for portal testing. */
export async function POST(request: Request) {
  if (!opsAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!orgoProvisionConfigured()) {
    return NextResponse.json({ error: "orgo_not_configured" }, { status: 503 });
  }

  const linkedIds = await listLinkedOrgoComputerIds();
  const before = await listOrgoWorkspaceComputers();
  const reclaimed = await claimStalePortalComputer({ keepIds: linkedIds });
  const cleaned = await cleanupStalePortalComputers({ keepIds: linkedIds, targetFree: 3 });
  const after = await listOrgoWorkspaceComputers();

  return NextResponse.json({
    ok: true,
    linkedCount: linkedIds.size,
    reclaimed: reclaimed?.id ?? null,
    cleaned,
    before: before.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    after: after.map((c) => ({ id: c.id, name: c.name, status: c.status })),
  });
}
