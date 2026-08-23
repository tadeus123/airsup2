import { NextResponse } from "next/server";
import {
  createOrgoComputerForUser,
  getOrgoComputer,
  openChromeToChatGpt,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";
import { setOrgoComputerForToken } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);
    const configured = orgoProvisionConfigured();
    if (!user.orgoComputerId) {
      return NextResponse.json({
        ok: true,
        hasOrgo: false,
        configured,
        username: user.username,
      });
    }

    let status = "linked";
    if (configured) {
      try {
        const computer = await getOrgoComputer(user.orgoComputerId);
        status = computer.status || status;
      } catch {
        status = "unknown";
      }
    }

    return NextResponse.json({
      ok: true,
      hasOrgo: true,
      configured,
      username: user.username,
      orgoComputerId: user.orgoComputerId,
      status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "orgo_status_failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);

    if (user.orgoComputerId) {
      let status = "linked";
      if (orgoProvisionConfigured()) {
        try {
          const computer = await getOrgoComputer(user.orgoComputerId);
          status = computer.status || status;
        } catch {
          status = "unknown";
        }
      }
      return NextResponse.json({
        ok: true,
        alreadyProvisioned: true,
        orgoComputerId: user.orgoComputerId,
        status,
      });
    }

    if (!orgoProvisionConfigured()) {
      return NextResponse.json(
        {
          error: "orgo_not_configured",
          message:
            "Orgo provisioning is not configured on this server (missing ORGO_API_KEY or ORGO_WORKSPACE_ID).",
        },
        { status: 503 }
      );
    }

    const created = await createOrgoComputerForUser(user.username);
    const computerId = (created.id || "").trim();
    if (!computerId) {
      throw new Error("Orgo did not return a computer id");
    }

    await setOrgoComputerForToken({ token, orgoComputerId: computerId });

    void openChromeToChatGpt(computerId).catch(() => {});

    return NextResponse.json({
      ok: true,
      alreadyProvisioned: false,
      orgoComputerId: computerId,
      status: created.status || "creating",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provision_failed";
    const status =
      message === "Unauthorized"
        ? 401
        : message.includes("not configured")
          ? 503
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
