"use client";

import { useEffect, useRef } from "react";
import { NOVNC_URL } from "@/app/portal/chatgpt/ChatGptLoginFrame";
import { fetchPortalDesktop, startPortalSession } from "@/lib/portal-client";

/** Start VM + Chrome while the user is still on the portal landing. */
export function usePortalWarmup() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void import(/* webpackIgnore: true */ NOVNC_URL).catch(() => {});

    void (async () => {
      try {
        const startedSession = await startPortalSession();
        // Prefetch desktop + kick Chrome so /portal/chatgpt is near-instant.
        await fetchPortalDesktop(startedSession.token, {
          launch: true,
          waitMs: 20000,
        });
      } catch {
        // Best-effort — chatgpt page retries.
      }
    })();
  }, []);
}
