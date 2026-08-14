import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

export type McpToolExtra = RequestHandlerExtra<
  ServerRequest,
  ServerNotification
>;

/** Send MCP progress notification (shows live status in ChatGPT during long tool calls). */
export async function sendMcpProgress(
  extra: McpToolExtra | undefined,
  input: { progress: number; total?: number; message: string }
): Promise<void> {
  const token = extra?._meta?.progressToken;
  if (token === undefined || token === null || !extra?.sendNotification) return;
  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress: input.progress,
        total: input.total,
        message: input.message,
      },
    });
  } catch {
    // Progress is best-effort; never fail the tool call.
  }
}

export type ProgressReporter = (
  message: string,
  progress: number,
  total?: number
) => Promise<void>;

/** Build a reporter bound to MCP tool extra. */
export function bindProgressReporter(
  extra: McpToolExtra | undefined,
  total = 100
): ProgressReporter {
  let lastProgress = 0;
  return async (message, progress, progressTotal) => {
    const p = Math.max(lastProgress + 0.01, progress);
    lastProgress = p;
    await sendMcpProgress(extra, {
      progress: p,
      total: progressTotal ?? total,
      message,
    });
  };
}

export type ProgressTiming = {
  elapsedSec: number;
  typicalMinSec: number;
  typicalMaxSec: number;
};

/** Human-readable elapsed + ETA for long-running MCP tool progress. */
export function formatProgressTiming(t: ProgressTiming): string {
  const { elapsedSec, typicalMinSec, typicalMaxSec } = t;
  if (elapsedSec < typicalMinSec) {
    return `${elapsedSec}s · usually ${typicalMinSec}–${typicalMaxSec}s total`;
  }
  if (elapsedSec <= typicalMaxSec) {
    const left = Math.max(1, typicalMaxSec - elapsedSec);
    return `${elapsedSec}s · ~${left}s left (up to ${typicalMaxSec}s)`;
  }
  const over = elapsedSec - typicalMaxSec;
  return `${elapsedSec}s · slower than usual (+${over}s), still working…`;
}

function orgoTypicalMaxSec(): number {
  const ms = Number(process.env.ORGO_TIMEOUT_MS || 120_000) || 120_000;
  return Math.max(30, Math.round(ms / 1000));
}

/** Heartbeat progress messages while an async operation runs. */
export async function withProgressHeartbeat<T>(
  run: () => Promise<T>,
  report: ProgressReporter,
  input: {
    startMessage: string;
    tickMessage: (timing: ProgressTiming) => string;
    startProgress?: number;
    endProgress?: number;
    intervalMs?: number;
    typicalMinSec?: number;
    typicalMaxSec?: number;
  }
): Promise<T> {
  const start = Date.now();
  const startP = input.startProgress ?? 20;
  const endP = input.endProgress ?? 90;
  const typicalMinSec = input.typicalMinSec ?? 30;
  const typicalMaxSec = input.typicalMaxSec ?? orgoTypicalMaxSec();
  await report(input.startMessage, startP);
  const intervalMs = input.intervalMs ?? 5000;

  const tick = () => {
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const ratio = Math.min(1, elapsedSec / typicalMaxSec);
    const p = startP + (endP - startP) * ratio;
    void report(
      input.tickMessage({ elapsedSec, typicalMinSec, typicalMaxSec }),
      p
    );
  };

  const timer = setInterval(tick, intervalMs);
  const early = setTimeout(tick, Math.min(3000, intervalMs));

  try {
    return await run();
  } finally {
    clearInterval(timer);
    clearTimeout(early);
  }
}
