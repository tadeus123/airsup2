/** Routes concurrent Orgo relays: parallel separate threads, serial back-and-forth. */

import { acquireOrgoRelayLease, orgoLeaseBackend } from "./orgo-relay-lease";

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
  const n = Number(process.env.ORGO_MAX_CONCURRENT_RELAYS || 1);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(Math.floor(n), 4));
}

/** In-memory fallback for local dev without Supabase leases. */
const conversationTail = new Map<string, Promise<void>>();
const computerActive = new Map<string, number>();
const computerWaiters = new Map<string, Array<() => void>>();

async function withInMemoryConversationLock<T>(
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

async function acquireInMemoryComputerSlot(
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

function releaseInMemoryComputerSlot(computerId: string): void {
  const active = Math.max(0, (computerActive.get(computerId) ?? 1) - 1);
  computerActive.set(computerId, active);
  const q = computerWaiters.get(computerId);
  const next = q?.shift();
  if (next) next();
  if (!q?.length) computerWaiters.delete(computerId);
}

async function runInMemoryCoordinated<T>(
  input: OrgoRelayCoordination & { run: () => Promise<T> }
): Promise<T> {
  const key = convKey(input.computerId, input.conversationId);
  const needsParallelSlot = !input.continueThread;

  return withInMemoryConversationLock(key, input.onWait, async () => {
    if (needsParallelSlot) {
      await acquireInMemoryComputerSlot(input.computerId, input.onWait);
      try {
        return await input.run();
      } finally {
        releaseInMemoryComputerSlot(input.computerId);
      }
    }
    return input.run();
  });
}

/**
 * Route Orgo browser relays:
 * - Supabase leases when configured (Vercel multi-instance safe).
 * - In-memory fallback for local dev.
 * - Same conversation_id → serialized; different conversations → parallel up to N.
 */
export async function runOrgoRelayCoordinated<T>(
  input: OrgoRelayCoordination & { run: () => Promise<T> }
): Promise<T> {
  if (orgoLeaseBackend() === "supabase") {
    const lease = await acquireOrgoRelayLease({
      computerId: input.computerId,
      conversationId: input.conversationId,
      onWait: input.onWait
        ? async (message) => input.onWait!(message, "computer_capacity")
        : undefined,
    });
    try {
      return await input.run();
    } finally {
      await lease.release();
    }
  }
  return runInMemoryCoordinated(input);
}

export function __resetOrgoRelayCoordinatorForTests(): void {
  conversationTail.clear();
  computerActive.clear();
  computerWaiters.clear();
}

export { orgoLeaseBackend };
