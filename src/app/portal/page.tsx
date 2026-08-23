"use client";

import { useRouter } from "next/navigation";

function PortalChoiceButton({
  label,
  logoSrc,
  logoClassName,
  onClick,
}: {
  label: string;
  logoSrc: string;
  logoClassName?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="portal-choice-btn" onClick={onClick}>
      <span className="portal-choice-label">{label}</span>
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className={`portal-choice-logo${logoClassName ? ` ${logoClassName}` : ""}`}
      />
    </button>
  );
}

export default function PortalPage() {
  const router = useRouter();

  return (
    <main className="portal-page">
      <div className="portal-hero">
        <div className="portal-entry">
          <h1 className="portal-headline">enter portal</h1>
          <div className="portal-choice-stack">
            <PortalChoiceButton
              label="with chatgpt"
              logoSrc="/portal/chatgpt-logo.svg"
              onClick={() => router.push("/portal/setup")}
            />
            <PortalChoiceButton
              label="with claude"
              logoSrc="/portal/claude-logo.svg"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
