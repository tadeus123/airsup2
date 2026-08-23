"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ChatGptBrandIcon, ClaudeBrandIcon } from "@/components/portal/PortalBrandIcons";

function PortalChoiceButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
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
      {icon}
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
              icon={<ChatGptBrandIcon className="portal-choice-logo portal-chatgpt-icon" />}
              onClick={() => router.push("/portal/chatgpt")}
            />
            <PortalChoiceButton
              label="with claude"
              icon={<ClaudeBrandIcon className="portal-choice-logo portal-claude-icon" />}
              disabled
            />
          </div>
        </div>
      </div>
    </main>
  );
}
