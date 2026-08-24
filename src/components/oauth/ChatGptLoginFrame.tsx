"use client";

import { useEffect, useRef, useState } from "react";

const NOVNC_URL = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js";

type Props = {
  vncUrl: string;
  password: string;
};

type RfbInstance = {
  disconnect: () => void;
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  background: string;
  focusOnClick: boolean;
  showDotCursor: boolean;
  sendCredentials: (creds: { password: string }) => void;
  addEventListener: (type: string, fn: () => void) => void;
};

export default function ChatGptLoginFrame({ vncUrl, password }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mod = (await import(
          /* webpackIgnore: true */
          NOVNC_URL
        )) as { default: new (el: HTMLElement, url: string, opts?: object) => RfbInstance };
        if (cancelled || !hostRef.current) return;

        const rfb = new mod.default(hostRef.current, vncUrl, {
          credentials: { password },
        });
        rfbRef.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.clipViewport = true;
        rfb.background = "#2c2a26";
        rfb.focusOnClick = true;
        rfb.showDotCursor = true;
        rfb.addEventListener("connect", () => {
          setConnected(true);
          hostRef.current?.focus();
        });
        rfb.addEventListener("disconnect", () => setConnected(false));
        rfb.addEventListener("credentialsrequired", () => {
          rfb.sendCredentials({ password });
        });
        rfb.addEventListener("securityfailure", () => setFailed(true));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      rfbRef.current?.disconnect();
      rfbRef.current = null;
    };
  }, [vncUrl, password]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const ro = new ResizeObserver(() => {
      const rfb = rfbRef.current;
      if (!rfb) return;
      rfb.scaleViewport = true;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`oauth-vnc-frame${connected ? " oauth-vnc-frame--live" : ""}${failed ? " oauth-vnc-frame--failed" : ""}`}
    >
      {!connected && !failed ? <p className="oauth-vnc-frame-status">…</p> : null}
      {failed ? (
        <p className="oauth-vnc-frame-error">Could not load — refresh to retry.</p>
      ) : null}
      <div ref={hostRef} className="oauth-vnc-host" tabIndex={0} aria-label="ChatGPT login window" />
    </div>
  );
}

export { NOVNC_URL };
