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

/** Heartbeat progress messages while an async operation runs. */
export async function withProgressHeartbeat<T>(
  run: () => Promise<T>,
  report: ProgressReporter,
  input: {
    startMessage: string;
    tickMessage: (elapsedSec: number) => string;
    startProgress?: number;
    endProgress?: number;
    intervalMs?: number;
  }
): Promise<T> {
  const start = Date.now();
  const startP = input.startProgress ?? 20;
  const endP = input.endProgress ?? 90;
  await report(input.startMessage, startP);
  const intervalMs = input.intervalMs ?? 8000;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const elapsed = Math.round((Date.now() - start) / 1000);
    const ratio = Math.min(1, elapsed / 120);
    const p = startP + (endP - startP) * ratio;
    void report(input.tickMessage(elapsed), p);
  }, intervalMs);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}
