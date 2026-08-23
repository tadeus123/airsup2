import { NextResponse } from "next/server";
import {
  createOrgoComputerForUser,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";
import { registerPortalUser } from "@/lib/portal-user";
import { setOrgoComputerForToken, type User } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!orgoProvisionConfigured()) {
      return NextResponse.json(
        {
          error: "orgo_not_configured",
          message:
            "ChatGPT connect is not configured yet (missing ORGO_API_KEY or ORGO_WORKSPACE_ID on server).",
        },
        { status: 503 }
      );
    }

    let token = bearerFromRequest(request);
    let user: User | undefined;

    if (token) {
      try {
        user = await authPortalUser(token);
      } catch {
        token = "";
        user = undefined;
      }
    }

    if (!token || !user) {
      const created = await registerPortalUser();
      user = created.user;
      token = created.token;
    }

    let orgoComputerId = (user.orgoComputerId || "").trim();
    let provisioned = false;

    if (!orgoComputerId) {
      const created = await createOrgoComputerForUser(user.username);
      orgoComputerId = (created.id || "").trim();
      if (!orgoComputerId) throw new Error("Orgo did not return a computer id");
      await setOrgoComputerForToken({ token, orgoComputerId });
      provisioned = true;
    }

    return NextResponse.json({
      ok: true,
      token,
      orgoComputerId,
      provisioned,
      status: provisioned ? "starting" : "ready",
      username: user.username,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "portal_start_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
