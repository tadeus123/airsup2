import { supabaseConfig, supabaseRpc } from "./users";

export type EventSeverity = "info" | "warn" | "error";

export type AirsupEventInput = {
  kind: string;
  severity?: EventSeverity;
  ok?: boolean;
  username?: string;
  peerUsername?: string;
  messageId?: number | null;
  computerId?: string | null;
  requestId?: string;
  summary: string;
  detail?: Record<string, unknown>;
};

/** Fire-and-forget DB event — never throws into product paths. */
export function logAirsupEventSafe(input: AirsupEventInput): void {
  void persistAirsupEvent(input).catch(() => {});
}

export async function persistAirsupEvent(
  input: AirsupEventInput
): Promise<number | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const severity: EventSeverity =
    input.severity || (input.ok === false ? "error" : "info");
  try {
    const id = await supabaseRpc<number>("airsup_event_log", {
      p_token: cfg.token,
      p_kind: input.kind,
      p_severity: severity,
      p_ok: input.ok !== false,
      p_username: input.username || "",
      p_peer: input.peerUsername || "",
      p_message_id: input.messageId ?? null,
      p_computer_id: input.computerId ?? null,
      p_request_id: input.requestId || "",
      p_summary: (input.summary || "").slice(0, 400),
      p_detail: input.detail || {},
    });
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

export type FailuresReport = {
  ok: boolean;
  since?: string;
  events: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  counts: { events: number; messages: number };
};

export async function listFailures(input?: {
  hours?: number;
  limit?: number;
}): Promise<FailuresReport> {
  const cfg = supabaseConfig();
  if (!cfg) {
    return { ok: false, events: [], messages: [], counts: { events: 0, messages: 0 } };
  }
  const row = await supabaseRpc<FailuresReport>("airsup_failures_list", {
    p_token: cfg.token,
    p_hours: input?.hours ?? 48,
    p_limit: input?.limit ?? 50,
  });
  if (!row || typeof row !== "object") {
    return { ok: false, events: [], messages: [], counts: { events: 0, messages: 0 } };
  }
  return {
    ok: Boolean(row.ok),
    since: row.since,
    events: Array.isArray(row.events) ? row.events : [],
    messages: Array.isArray(row.messages) ? row.messages : [],
    counts: {
      events: Number(row.counts?.events || 0),
      messages: Number(row.counts?.messages || 0),
    },
  };
}

/** Flatten for chat / CLI: one line per issue. */
export function formatFailuresList(report: FailuresReport): string[] {
  const lines: string[] = [];
  for (const m of report.messages) {
    const id = m.message_id ?? m.id;
    const issue = String(m.issue || "message_issue");
    const from = String(m.username || "?");
    const to = String(m.peer_username || "?");
    const err = m.wake_error ? ` (${String(m.wake_error).slice(0, 100)})` : "";
    lines.push(
      `[msg #${id}] ${issue}: ${from} → ${to}${err} @ ${String(m.created_at || "")}`
    );
  }
  for (const e of report.events) {
    lines.push(
      `[event ${e.kind}] ${e.severity}: ${String(e.summary || "").slice(0, 160)} @ ${String(e.created_at || "")}`
    );
  }
  return lines;
}
