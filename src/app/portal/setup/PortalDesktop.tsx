"use client";

type Props = {
  desktopUrl: string;
};

export default function PortalDesktop({ desktopUrl }: Props) {
  return (
    <div className="portal-desktop-wrap">
      <div className="portal-desktop-status" aria-live="polite">
        <span className="portal-desktop-dot portal-desktop-dot--live" aria-hidden="true" />
        your workspace is ready
      </div>
      <div className="portal-desktop-frame">
        <iframe
          src={desktopUrl}
          title="your workspace"
          className="portal-desktop-iframe"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
