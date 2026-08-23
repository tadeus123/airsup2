"use client";

type Props = {
  desktopUrl: string;
};

/** Native Orgo desktop embed — no broken noVNC CDN dependency. */
export default function ChatGptLoginFrame({ desktopUrl }: Props) {
  return (
    <div className="portal-chatgpt-login-card portal-chatgpt-login-card--live">
      <iframe
        src={desktopUrl}
        title="chatgpt login"
        className="portal-chatgpt-desktop-iframe"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
