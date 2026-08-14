/** Routes concurrent Orgo relays: parallel separate threads, serial back-and-forth. */

type WaitReason = "conversation" | "computer_capacity";

export type OrgoRelayCoordination = {
  computerId: string;
  conversationId: string;
  continueThread: boolean;
  onWait?: (message: string, reason: WaitReason) => Promise<void>;
};

function convKey(computerId: string, conversationId: string): string {
  return `${computerId}::${conversationId.trim()}`;
}

function maxConcurrentRelaysPerComputer(): number {
  const n = Number(process.env.ORGO_MAX_CONCURRENT_RELAYS || 2);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(Math.floor(n), 4));
}

/** Per-conversation chain — one relay at a time per thread (back-and-forth). */
const conversationTail = new Map<string, Promise<void>>();

/** Parallel new-chat relays currently active per Orgo computer. */
const computerActive = new Map<string, number>();
const computerWaiters = new Map<string, Array<() => void>>();

async function withConversationLock<T>(
  key: string,
  onWait: OrgoRelayCoordination["onWait"],
  run: () => Promise<T>
): Promise<T> {
  const prev = conversationTail.get(key);
  if (prev) {
    await onWait?.("Waiting for prior message in this thread…", "conversation");
    await prev.catch(() => {});
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  conversationTail.set(key, gate);

  try {
    return await run();
  } finally {
    release();
    if (conversationTail.get(key) === gate) {
      conversationTail.delete(key);
    }
  }
}

async function acquireComputerSlot(
  computerId: string,
  onWait: OrgoRelayCoordination["onWait"]
): Promise<void> {
  const max = maxConcurrentRelaysPerComputer();
  const active = computerActive.get(computerId) ?? 0;
  if (active < max) {
    computerActive.set(computerId, active + 1);
    return;
  }

  await onWait?.(
    `${active} Airsup chat(s) already active on this Orgo computer — queued…`,
    "computer_capacity"
  );

  await new Promise<void>((resolve) => {
    const q = computerWaiters.get(computerId) ?? [];
    q.push(resolve);
    computerWaiters.set(computerId, q);
  });
  computerActive.set(computerId, (computerActive.get(computerId) ?? 0) + 1);
}

function releaseComputerSlot(computerId: string): void {
  const active = Math.max(0, (computerActive.get(computerId) ?? 1) - 1);
  computerActive.set(computerId, active);
  const q = computerWaiters.get(computerId);
  const next = q?.shift();
  if (next) next();
  if (!q?.length) computerWaiters.delete(computerId);
}

/** Active parallel relays on this Orgo computer (for prompt hints). */
export function orgoComputerActiveRelayCount(computerId: string): number {
  return computerActive.get(computerId) ?? 0;
}

/**
 * Route Orgo browser relays:
 * - Same conversation_id → same ChatGPT tab, serialized (back-and-forth).
 * - Different conversations → up to ORGO_MAX_CONCURRENT_RELAYS parallel new chats.
 */
export async function runOrgoRelayCoordinated<T>(
  input: OrgoRelayCoordination & { run: () => Promise<T> }
): Promise<T> {
  const key = convKey(input.computerId, input.conversationId);
  const needsParallelSlot = !input.continueThread;

  return withConversationLock(key, input.onWait, async () => {
    if (needsParallelSlot) {
      await acquireComputerSlot(input.computerId, input.onWait);
      try {
        return await input.run();
      } finally {
        releaseComputerSlot(input.computerId);
      }
    }
    return input.run();
  });
}

export function __resetOrgoRelayCoordinatorForTests(): void {
  conversationTail.clear();
  computerActive.clear();
  computerWaiters.clear();
}
