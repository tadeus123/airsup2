import { NextResponse } from "next/server";
import {
  getOrgoComputer,
  getOrgoVncPassword,
  orgoProvisionConfigured,
  orgoVncHostname,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);

    if (!user.orgoComputerId) {
      return NextResponse.json(
        { error: "no_orgo_computer", message: "No workspace linked yet." },
        { status: 404 }
      );
    }

    if (!orgoProvisionConfigured()) {
      return NextResponse.json(
        {
          error: "orgo_not_configured",
          message:
            "Orgo is not configured on this server (missing ORGO_API_KEY or ORGO_WORKSPACE_ID).",
        },
        { status: 503 }
      );
    }

    const computer = await getOrgoComputer(user.orgoComputerId);
    const password = await getOrgoVncPassword(user.orgoComputerId);
    const instanceId = (computer.instance_id || "").trim();
    const vncHostname = orgoVncHostname(computer);

    return NextResponse.json(
      {
        ok: true,
        computerId: user.orgoComputerId,
        instanceId,
        password,
        vncHostname,
        status: computer.status || "unknown",
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "desktop_failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
