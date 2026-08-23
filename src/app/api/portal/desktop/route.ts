import { NextResponse } from "next/server";
import {
  getOrgoComputer,
  getOrgoVncPassword,
  openChromeToChatGpt,
  orgoProvisionConfigured,
  orgoVncWebSocketUrl,
  waitForComputerRunning,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);

    if (!user.orgoComputerId) {
      return NextResponse.json(
        { error: "not_ready", message: "Computer is still starting." },
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

    const url = new URL(request.url);
    const shouldWait = url.searchParams.get("wait") === "1";
    const shouldLaunch = url.searchParams.get("launch") === "1";
    const waitMs = Math.min(
      58000,
      Math.max(3000, Number(url.searchParams.get("waitMs") || 55000))
    );

    let computer = await getOrgoComputer(user.orgoComputerId);
    let instanceId = (computer.instance_id || "").trim();

    if (!instanceId && shouldWait) {
      computer = await waitForComputerRunning(user.orgoComputerId, waitMs);
      instanceId = (computer.instance_id || "").trim();
    }

    if (!instanceId) {
      return NextResponse.json(
        { error: "not_ready", message: "Computer is still starting." },
        { status: 404 }
      );
    }

    if (shouldLaunch) {
      void openChromeToChatGpt(user.orgoComputerId).catch(() => {});
    }

    const password = await getOrgoVncPassword(user.orgoComputerId);
    const vncUrl = orgoVncWebSocketUrl(computer, password);

    return NextResponse.json(
      {
        ok: true,
        computerId: user.orgoComputerId,
        instanceId,
        vncUrl,
        password,
        status: computer.status || "unknown",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "desktop_failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
