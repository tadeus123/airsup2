import { NextResponse } from "next/server";
import {
  claimStalePortalComputer,
  cleanupStalePortalComputers,
  createOrgoComputerForUser,
  forceFreeOrgoSlot,
  getOrgoComputer,
  listOrgoWorkspaceComputers,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { authPortalUser, bearerFromRequest } from "@/lib/portal-auth";
import { registerPortalUser } from "@/lib/portal-user";
import { listLinkedOrgoComputerIds, setOrgoComputerForToken, type User } from "@/lib/users";

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
      const linkedIds = await listLinkedOrgoComputerIds();
      let created: Awaited<ReturnType<typeof createOrgoComputerForUser>> | null = null;
      try {
        created = await createOrgoComputerForUser(user.username);
      } catch (firstError) {
        const firstMsg =
          firstError instanceof Error ? firstError.message : String(firstError);
        if (
          firstMsg.includes("Computer limit reached") ||
          firstMsg.includes("VM_SLOT") ||
          firstMsg.toLowerCase().includes("limit")
        ) {
          const reclaimed = await claimStalePortalComputer({ keepIds: linkedIds });
          if (reclaimed?.id) {
            created = reclaimed;
          } else {
            await cleanupStalePortalComputers({ keepIds: linkedIds, targetFree: 3 });
            try {
              created = await createOrgoComputerForUser(user.username);
            } catch {
              const reclaimedAfter = await claimStalePortalComputer({ keepIds: linkedIds });
              if (reclaimedAfter?.id) {
                created = reclaimedAfter;
              } else {
                await forceFreeOrgoSlot({ keepIds: linkedIds });
                try {
                  created = await createOrgoComputerForUser(user.username);
                } catch {
                  const sharedId = (
                    process.env.ORGO_PORTAL_SHARED_COMPUTER_ID ||
                    process.env.ORGO_DEFAULT_COMPUTER_ID ||
                    ""
                  ).trim();
                  if (sharedId) {
                    created = await getOrgoComputer(sharedId);
                  } else {
                    const pool = await listOrgoWorkspaceComputers();
                    const pick =
                      pool.find((c) => (c.status || "").toLowerCase() === "running") ||
                      pool[0];
                    if (pick?.id) created = pick;
                    else throw firstError;
                  }
                }
              }
            }
          }
        } else {
          throw firstError;
        }
      }
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
    if (message.includes("Computer limit reached") || message.includes("VM_SLOT")) {
      return NextResponse.json(
        {
          error: "orgo_capacity",
          message:
            "Portal is at capacity (Orgo computer limit). Delete unused computers in your Orgo workspace or add a slot.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
