import { randomUUID } from "node:crypto";
import { logAirsupEventSafe } from "./airsup-events";

export type ActivityKind =
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
  | "orgo_wake"
  | "orgo_send"
  | "check_inbox"
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
  messageId?: number | null;
  computerId?: string | null;
  severity?: "info" | "warn" | "error";
}): void {
  try {
    const ok = input.ok !== false;
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
        ok,
        username: input.username || "",
        peer: input.peerUsername || "",
        ms: input.durationMs || 0,
        req: input.requestId || "",
        summary: (input.summary || "").slice(0, 180),
        timing: timing || null,
      })
    );

    const severity =
      input.severity ||
      (!ok ? "error" : input.kind === "orgo_wake" || input.kind === "orgo_send"
        ? "info"
        : "info");

    // Persist failures + Orgo path events so "what is failing?" is queryable.
    const shouldPersist =
      !ok ||
      severity === "warn" ||
      severity === "error" ||
      input.kind === "orgo_wake" ||
      input.kind === "orgo_send";

    if (shouldPersist) {
      logAirsupEventSafe({
        kind: String(input.kind),
        severity: !ok ? "error" : severity,
        ok,
        username: input.username,
        peerUsername: input.peerUsername,
        messageId: input.messageId ?? null,
        computerId: input.computerId ?? null,
        requestId: input.requestId,
        summary: input.summary,
        detail: {
          ...(input.detail || {}),
          httpStatus: input.httpStatus ?? null,
          durationMs: input.durationMs ?? null,
        },
      });
    }
  } catch {
    // ignore
  }
}
