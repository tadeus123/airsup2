import { randomUUID } from "node:crypto";

export type ActivityKind =
  | "onboard"
  | "whoami"
  | "lookup"
  | "list_users"
  | "talk"
  | "await"
  | "cancel"
  | "watch"
  | "watch_skip"
  | "ack"
  | "reply_and_ack"
  | "orgo_relay"
  | "error";

export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

/** Fire-and-forget structured logs — never blocks product paths. */
export function logActivitySafe(input: {
  kind: ActivityKind | string;
  ok?: boolean;
  username?: string;
  peerUsername?: string;
  httpStatus?: number;
  durationMs?: number;
  summary: string;
  detail?: Record<string, unknown>;
  requestId?: string;
}): void {
  try {
    const timing =
      input.detail &&
      typeof input.detail === "object" &&
      input.detail.timing &&
      typeof input.detail.timing === "object"
        ? input.detail.timing
        : undefined;
    console.info(
      JSON.stringify({
        airsup_trace: true,
        kind: input.kind,
        ok: input.ok !== false,
        username: input.username || "",
        peer: input.peerUsername || "",
        ms: input.durationMs || 0,
        req: input.requestId || "",
        summary: (input.summary || "").slice(0, 180),
        timing: timing || null,
      })
    );
  } catch {
    // ignore
  }
}
