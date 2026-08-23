import { NextResponse } from "next/server";
import { logActivitySafe, newRequestId } from "@/lib/activity";
import {
  createOrgoComputerForUser,
  getOrgoComputer,
  orgoProvisionEnabled,
} from "@/lib/orgo-provision";
import {
  authUserFromRequest,
  setOrgoComputerForToken,
  setOrgoComputerForUsername,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function tokenFromRequest(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || "";
}

export async function GET(request: Request) {
  try {
    const user = await authUserFromRequest(request);
    if (!user.orgoComputerId) {
      return NextResponse.json({
        ok: true,
        provisioned: false,
        orgoProvisionEnabled: orgoProvisionEnabled(),
      });
    }
    let computer = null;
    if (orgoProvisionEnabled()) {
      try {
        computer = await getOrgoComputer(user.orgoComputerId);
      } catch {
        computer = null;
      }
    }
    return NextResponse.json({
      ok: true,
      provisioned: true,
      orgoComputerId: user.orgoComputerId,
      computer,
      orgoProvisionEnabled: orgoProvisionEnabled(),
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = newRequestId();
  try {
    const user = await authUserFromRequest(request);
    const token = tokenFromRequest(request);

    if (!orgoProvisionEnabled()) {
      return NextResponse.json(
        {
          error:
            "Orgo auto-provision is not configured (need ORGO_API_KEY + ORGO_WORKSPACE_ID on server)",
        },
        { status: 503 }
      );
    }

    if (user.orgoComputerId) {
      let computer = null;
      try {
        computer = await getOrgoComputer(user.orgoComputerId);
      } catch {
        // allow re-provision with force
      }
      const body = (await request.json().catch(() => ({}))) as { force?: boolean };
      if (computer && !body.force) {
        return NextResponse.json({
          ok: true,
          alreadyLinked: true,
          orgoComputerId: user.orgoComputerId,
          computer,
          desktopUrl: computer.url || computer.connection_url || null,
        });
      }
    }

    const created = await createOrgoComputerForUser({
      username: user.username,
      displayName: user.displayName,
    });

    const updated = token
      ? await setOrgoComputerForToken({ token, orgoComputerId: created.id })
      : await setOrgoComputerForUsername({
          username: user.username,
          orgoComputerId: created.id,
        });

    logActivitySafe({
      kind: "orgo_provision",
      ok: true,
      username: user.username,
      computerId: created.id,
      httpStatus: 201,
      durationMs: Date.now() - started,
      summary: `Provisioned Orgo computer for ${user.username}`,
      detail: { computerId: created.id, status: created.status, url: created.url },
      requestId,
    });

    return NextResponse.json({
      ok: true,
      orgoComputerId: updated.orgoComputerId,
      computer: created,
      desktopUrl: created.url || created.connection_url || null,
      instructions:
        "Open the desktop, launch Chrome, log into ChatGPT, then install your airsup MCP plugin there too.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provision_failed";
    logActivitySafe({
      kind: "orgo_provision",
      ok: false,
      httpStatus: 500,
      durationMs: Date.now() - started,
      summary: `Orgo provision failed: ${message}`,
      requestId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
