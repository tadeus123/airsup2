"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChatGptBrandIcon, ClaudeBrandIcon } from "@/components/portal/PortalBrandIcons";
import { usePortalWarmup } from "@/hooks/usePortalWarmup";

function PortalPassage({
  label,
  icon,
  href,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  disabled?: boolean;
}) {
  if (disabled || !href) {
    return (
      <button
        type="button"
        className="portal-passage portal-passage--disabled"
        disabled
        aria-disabled="true"
      >
        <span className="portal-passage-mark" aria-hidden="true">
          {icon}
        </span>
        <span className="portal-passage-label">{label}</span>
      </button>
    );
  }

  return (
    <Link href={href} className="portal-passage">
      <span className="portal-passage-mark" aria-hidden="true">
        {icon}
      </span>
      <span className="portal-passage-label">{label}</span>
    </Link>
  );
}

export default function PortalPage() {
  usePortalWarmup();

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
            href="/portal/chatgpt"
            icon={<ChatGptBrandIcon className="portal-passage-logo portal-chatgpt-icon" />}
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
