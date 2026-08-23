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
  sendCredentials: (creds: { password: string }) => void;
  addEventListener: (type: string, fn: () => void) => void;
};

export default function ChatGptLoginFrame({ vncUrl, password }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let rfb: RfbInstance | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const mod = (await import(
          /* webpackIgnore: true */
          NOVNC_URL
        )) as { default: new (el: HTMLElement, url: string, opts?: object) => RfbInstance };
        if (cancelled || !hostRef.current) return;

        rfb = new mod.default(hostRef.current, vncUrl, {
          credentials: { password },
        });
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.clipViewport = true;
        rfb.background = "#ffffff";
        rfb.addEventListener("connect", () => setConnected(true));
        rfb.addEventListener("disconnect", () => setConnected(false));
        rfb.addEventListener("credentialsrequired", () => {
          rfb?.sendCredentials({ password });
        });
        rfb.addEventListener("securityfailure", () => setFailed(true));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      rfb?.disconnect();
    };
  }, [vncUrl, password]);

  return (
    <div className="portal-chatgpt-login-card">
      {!connected && !failed ? (
        <p className="portal-chatgpt-login-loading">loading chatgpt…</p>
      ) : null}
      {failed ? (
        <p className="portal-chatgpt-login-error">
          could not load the login window — refresh to try again.
        </p>
      ) : null}
      <div
        ref={hostRef}
        className={`portal-chatgpt-vnc-host${connected ? " portal-chatgpt-vnc-host--live" : ""}`}
      />
    </div>
  );
}

export { NOVNC_URL };
