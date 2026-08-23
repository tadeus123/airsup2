"use client";

import { useEffect, useRef } from "react";
import { NOVNC_URL } from "@/app/portal/chatgpt/ChatGptLoginFrame";
import { startPortalSession } from "@/lib/portal-client";

/** Start VM provisioning + preload noVNC while on the portal landing. */
export function usePortalWarmup() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void import(/* webpackIgnore: true */ NOVNC_URL).catch(() => {});

    void startPortalSession().catch(() => {
      // Best-effort — chatgpt page retries.
    });
  }, []);
}
