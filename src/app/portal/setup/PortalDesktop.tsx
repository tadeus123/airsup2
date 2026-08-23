"use client";

import { ComputerDisplay } from "orgo-vnc";
import { useState } from "react";

type Props = {
  vncHostname: string;
  password: string;
};

export default function PortalDesktop({ vncHostname, password }: Props) {
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState("");

  return (
    <div className="portal-desktop-wrap">
      <div className="portal-desktop-status" aria-live="polite">
        <span
          className={`portal-desktop-dot${connected ? " portal-desktop-dot--live" : ""}`}
          aria-hidden="true"
        />
        {connectError
          ? "connection issue — try refreshing"
          : connected
            ? "your workspace is ready"
            : "connecting…"}
      </div>
      <div className="portal-desktop-frame">
        <ComputerDisplay
          hostname={vncHostname}
          password={password}
          background="#f2f1e8"
          readOnly={false}
          scaleViewport
          clipViewport
          resizeSession
          showDotCursor
          className="portal-desktop-vnc"
          onConnect={() => {
            setConnected(true);
            setConnectError("");
          }}
          onDisconnect={() => setConnected(false)}
          onError={(msg) => setConnectError(msg)}
        />
      </div>
    </div>
  );
}
