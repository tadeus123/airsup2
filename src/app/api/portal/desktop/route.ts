import { after } from "next/server";
import { NextResponse } from "next/server";
import {
  launchChatGptLoginWithRetries,
  orgoProvisionConfigured,
  resolveOrgoDesktopSession,
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
      45000,
      Math.max(3000, Number(url.searchParams.get("waitMs") || 25000))
    );

    if (!shouldWait) {
      return NextResponse.json(
        {
          error: "not_ready",
          message: "Use wait=1 to wait for the desktop.",
        },
        { status: 400 }
      );
    }

    const session = await resolveOrgoDesktopSession(user.orgoComputerId, {
      waitMs,
    });

    // Don't block the user on Chrome — open it after we return VNC.
    if (shouldLaunch) {
      const computerId = user.orgoComputerId;
      after(() => {
        void launchChatGptLoginWithRetries(computerId).catch(() => {});
      });
    }

    return NextResponse.json(
      {
        ok: true,
        computerId: user.orgoComputerId,
        instanceId: session.computer.instance_id,
        desktopUrl: session.desktopUrl,
        vncUrl: session.vncUrl,
        password: session.password,
        status: session.computer.status || "running",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "desktop_failed";
    if (message.includes("still starting")) {
      return NextResponse.json(
        { error: "not_ready", message },
        { status: 503 }
      );
    }
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
