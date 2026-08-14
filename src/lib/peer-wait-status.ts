export type PeerWaitState = "thinking" | "waking" | "offline" | "unknown";

export type PeerWaitStatus = {
  state: PeerWaitState;
  detail: string;
  opened_at: string | null;
  wake_sent_at: string | null;
  seconds_open: number | null;
  seconds_since_wake: number | null;
};

const OPEN_GRACE_SEC = 90;

function ageSec(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

export function describePeerWait(row: {
  deliveredAt?: string | null;
  wakeSentAt?: string | null;
  wakeError?: string | null;
  createdAt?: string | null;
  peerUsername?: string;
}): PeerWaitStatus {
  const now = Date.now();
  const peer = row.peerUsername || "them";
  const openedAt = row.deliveredAt || null;
  const wakeSentAt = row.wakeSentAt || null;
  const secondsOpen = ageSec(openedAt, now);
  const secondsSinceWake = ageSec(wakeSentAt, now);

  if (row.wakeError) {
    return {
      state: "offline",
      detail: `Wake to ${peer} failed (${row.wakeError.slice(0, 120)}). Their Orgo or ChatGPT may be down.`,
      opened_at: openedAt,
      wake_sent_at: wakeSentAt,
      seconds_open: secondsOpen,
      seconds_since_wake: secondsSinceWake,
    };
  }

  if (openedAt) {
    const mins = Math.max(1, Math.round((secondsOpen ?? 0) / 60));
    return {
      state: "thinking",
      detail: `${peer} opened the message ${mins}m ago and is still working (Gmail, Drive, past chats). Keep waiting — this is not offline.`,
      opened_at: openedAt,
      wake_sent_at: wakeSentAt,
      seconds_open: secondsOpen,
      seconds_since_wake: secondsSinceWake,
    };
  }

  if (wakeSentAt) {
    if ((secondsSinceWake ?? 0) < OPEN_GRACE_SEC) {
      return {
        state: "waking",
        detail: `Wake reached ${peer}'s ChatGPT ${secondsSinceWake}s ago. Waiting for them to open it.`,
        opened_at: openedAt,
        wake_sent_at: wakeSentAt,
        seconds_open: secondsOpen,
        seconds_since_wake: secondsSinceWake,
      };
    }
    return {
      state: "offline",
      detail: `Wake was sent ${secondsSinceWake}s ago but ${peer} never opened it. Plugin may be off, or ChatGPT did not pick up the paste.`,
      opened_at: openedAt,
      wake_sent_at: wakeSentAt,
      seconds_open: secondsOpen,
      seconds_since_wake: secondsSinceWake,
    };
  }

  const created = ageSec(row.createdAt, now) ?? 0;
  if (created < 60) {
    return {
      state: "waking",
      detail: `Message just stored. Waiting for ${peer}'s ChatGPT to be woken.`,
      opened_at: openedAt,
      wake_sent_at: wakeSentAt,
      seconds_open: secondsOpen,
      seconds_since_wake: secondsSinceWake,
    };
  }
  return {
    state: "unknown",
    detail: `No wake or open signal from ${peer} yet. Keep waiting once, then tell the human if it stays empty.`,
    opened_at: openedAt,
    wake_sent_at: wakeSentAt,
    seconds_open: secondsOpen,
    seconds_since_wake: secondsSinceWake,
  };
}

export function awaitInstructionsForPeerStatus(
  status: PeerWaitStatus,
  from: string
): string {
  if (status.state === "thinking") {
    return `peer_status=thinking. ${from} is still working. Immediately call await_reply again with the SAME ids. Do not tell the human they have not replied.`;
  }
  if (status.state === "waking") {
    return `peer_status=waking. ${from} has not opened the message yet. Call await_reply again with the SAME ids.`;
  }
  if (status.state === "offline") {
    return `peer_status=offline. You may tell the human ${from} might be offline, then call await_reply once more in case they come back.`;
  }
  return `peer_status=unknown. Call await_reply again with the SAME ids.`;
}
