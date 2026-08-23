"use client";

import { useRouter } from "next/navigation";

function PortalChoiceButton({
  label,
  logoSrc,
  onClick,
  disabled,
}: {
  label: string;
  logoSrc: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`portal-choice-btn${disabled ? " portal-choice-btn--disabled" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      <span className="portal-choice-label">{label}</span>
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className="portal-choice-logo"
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
          <h1 className="portal-headline">cross the vail</h1>
          <div className="portal-choice-stack">
            <PortalChoiceButton
              label="with chatgpt"
              logoSrc="/portal/chatgpt-logo.svg"
              onClick={() => router.push("/portal/chatgpt")}
            />
            <PortalChoiceButton
              label="with claude"
              logoSrc="/portal/claude-logo.svg"
              disabled
            />
          </div>
        </div>
      </div>
    </main>
  );
}
