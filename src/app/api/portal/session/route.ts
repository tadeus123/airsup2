import { NextResponse } from "next/server";
import { authPortalUser } from "@/lib/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = (body.token || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const user = await authPortalUser(token);
    const hasOrgo = Boolean(user.orgoComputerId);
    return NextResponse.json({
      ok: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        orgoComputerId: user.orgoComputerId ?? null,
      },
      hasOrgo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "session_failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
