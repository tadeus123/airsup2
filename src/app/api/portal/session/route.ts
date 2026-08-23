import { NextResponse } from "next/server";
import {
  authUserFromRequest,
  hashUserToken,
  getUserByUsername,
  supabaseRpc,
  supabaseConfig,
  type User,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function userFromToken(token: string): Promise<User | null> {
  const t = token.trim();
  if (!t) return null;
  const forged = new Request("https://airsup.local/api/portal/session", {
    method: "POST",
    headers: { authorization: `Bearer ${t}` },
  });
  try {
    return await authUserFromRequest(forged);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = (body.token || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const user = await userFromToken(token);
    if (!user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      ok: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        orgoComputerId: user.orgoComputerId ?? null,
      },
      mcpUrl: `${origin}/mcp/${token}`,
      hasOrgo: Boolean(user.orgoComputerId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "session_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const user = await authUserFromRequest(request);
    const origin = new URL(request.url).origin;
    const tokenFromHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    return NextResponse.json({
      ok: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        orgoComputerId: user.orgoComputerId ?? null,
      },
      mcpUrl: tokenFromHeader ? `${origin}/mcp/${tokenFromHeader}` : null,
      hasOrgo: Boolean(user.orgoComputerId),
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
