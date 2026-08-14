import { NextResponse } from "next/server";
import { normalizeOrgoComputerId } from "@/lib/orgo-routing";
import { setOrgoComputerForToken } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      orgoComputerId?: string;
      orgo_computer_id?: string;
    };
    const token = (body.token || "").trim();
    const raw = (body.orgoComputerId || body.orgo_computer_id || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const orgoComputerId = normalizeOrgoComputerId(raw);
    if (!orgoComputerId) {
      return NextResponse.json(
        { error: "orgoComputerId is required" },
        { status: 400 }
      );
    }
    const user = await setOrgoComputerForToken({ token, orgoComputerId });
    return NextResponse.json({
      ok: true,
      username: user.username,
      orgoComputerId: user.orgoComputerId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "save_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
