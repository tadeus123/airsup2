"use client";

import { useEffect, useRef } from "react";
import { startPortalSession } from "@/lib/portal-client";

/** Start VM provisioning while the user is on the portal landing. */
export function usePortalWarmup() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void startPortalSession().catch(() => {
      // Best-effort — chatgpt page retries.
    });
  }, []);
}
