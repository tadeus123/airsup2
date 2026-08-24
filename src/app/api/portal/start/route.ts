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
import { listLinkedOrgoComputerIds, setOrgoComputerForToken, type User } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Last-resort IDs referenced in repo scripts — used only when Orgo is at capacity. */
const PORTAL_FALLBACK_COMPUTER_IDS = [
  "099c33f0-8459-47bb-8e4d-3b94329e2c85",
  "dca96bed-5904-4e6b-ada3-8be624df291a",
];

async function borrowExistingOrgoComputer(
  linkedIds: Set<string>
): Promise<Awaited<ReturnType<typeof createOrgoComputerForUser>> | null> {
  const sharedId = (
    process.env.ORGO_PORTAL_SHARED_COMPUTER_ID ||
    process.env.ORGO_DEFAULT_COMPUTER_ID ||
    ""
  ).trim();
  const tryIds = [
    sharedId,
    ...PORTAL_FALLBACK_COMPUTER_IDS,
    ...(await listOrgoWorkspaceComputers()).map((c) => c.id),
  ].filter(Boolean);

  const seen = new Set<string>();
  for (const id of tryIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    try {
      return await getOrgoComputer(trimmed);
    } catch {
      // try next
    }
  }
  return null;
}

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

    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json(
        { error: "unauthorized", message: "Missing session — reconnect the plugin" },
        { status: 401 }
      );
    }

    let user: User;
    try {
      user = await authPortalUser(token);
    } catch {
      return NextResponse.json(
        { error: "session_invalid", message: "Session expired — reconnect the plugin" },
        { status: 401 }
      );
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
                  created = await borrowExistingOrgoComputer(linkedIds);
                  if (!created) throw firstError;
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
    const message = error instanceof Error ? error.message : "desktop_start_failed";
    if (message.includes("Computer limit reached") || message.includes("VM_SLOT")) {
      return NextResponse.json(
        {
          error: "orgo_capacity",
          message:
            "At Orgo computer limit. Delete unused computers in your Orgo workspace or add a slot.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
