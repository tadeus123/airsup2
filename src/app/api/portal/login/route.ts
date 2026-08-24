import { NextResponse } from "next/server";
import {
  fillChatGptLoginOnDesktop,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);
    const computerId = (user.orgoComputerId || "").trim();
    if (!computerId) {
      return NextResponse.json(
        { error: "not_ready", message: "Computer is still starting." },
        { status: 404 }
      );
    }
    if (!orgoProvisionConfigured()) {
      return NextResponse.json({ error: "orgo_not_configured" }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = (body.email || "").trim();
    const password = body.password || "";
    if (!email || !password) {
      return NextResponse.json(
        { error: "missing_credentials", message: "email and password are required" },
        { status: 400 }
      );
    }
    if (email.length > 254 || password.length > 200) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
    }

    await fillChatGptLoginOnDesktop(computerId, email, password);

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "login_failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
