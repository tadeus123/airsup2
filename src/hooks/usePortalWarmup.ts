"use client";

import { useEffect, useRef } from "react";
import { preloadNovnc, startPortalSession } from "@/lib/portal-client";

/**
 * Silently start VM provisioning while the user reads the portal landing.
 * Cuts perceived wait when they click "with chatgpt".
 */
export function usePortalWarmup() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    preloadNovnc();

    void startPortalSession().catch(() => {
      // Warmup is best-effort — chatgpt page retries on failure.
    });
  }, []);
}
