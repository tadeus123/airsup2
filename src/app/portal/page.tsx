"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ChatGptBrandIcon, ClaudeBrandIcon } from "@/components/portal/PortalBrandIcons";

function PortalPassage({
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
      className={`portal-passage${disabled ? " portal-passage--disabled" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      <span className="portal-passage-mark" aria-hidden="true">
        {icon}
      </span>
      <span className="portal-passage-label">{label}</span>
    </button>
  );
}

export default function PortalPage() {
  const router = useRouter();

  return (
    <main className="portal-page">
      <div className="portal-threshold" aria-label="portal entry">
        <div className="portal-threshold-corners" aria-hidden="true" />
        <header className="portal-headline-block">
          <h1 className="portal-headline">
            <span className="portal-headline-lead">cross the</span>
            <span className="portal-headline-veil">veil</span>
          </h1>
          <div className="portal-headline-ornament" aria-hidden="true" />
        </header>
        <nav className="portal-passages" aria-label="choose your path">
          <PortalPassage
            label="with chatgpt"
            icon={<ChatGptBrandIcon className="portal-passage-logo portal-chatgpt-icon" />}
            onClick={() => router.push("/portal/chatgpt")}
          />
          <PortalPassage
            label="with claude"
            icon={<ClaudeBrandIcon className="portal-passage-logo portal-claude-icon" />}
            disabled
          />
        </nav>
      </div>
    </main>
  );
}
