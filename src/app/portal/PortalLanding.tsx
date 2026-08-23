"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChatGptBrandIcon, ClaudeBrandIcon } from "@/components/portal/PortalBrandIcons";
import { usePortalWarmup } from "@/hooks/usePortalWarmup";

function GatePath({
  label,
  icon,
  href,
  soon,
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  soon?: boolean;
}) {
  if (soon || !href) {
    return (
      <div className="portal-gate-path portal-gate-path--soon" aria-disabled="true">
        <span className="portal-gate-path-main">
          <span className="portal-gate-path-label">{label}</span>
          <span className="portal-gate-path-mark">{icon}</span>
        </span>
        <span className="portal-gate-path-meta">soon</span>
      </div>
    );
  }

  return (
    <Link href={href} className="portal-gate-path portal-gate-path--live">
      <span className="portal-gate-path-main">
        <span className="portal-gate-path-label">{label}</span>
        <span className="portal-gate-path-mark">{icon}</span>
      </span>
      <span className="portal-gate-path-meta" aria-hidden="true">
        enter →
      </span>
    </Link>
  );
}

export default function PortalLanding() {
  usePortalWarmup();

  return (
    <main className="portal-gate">
      <div className="portal-gate-light" aria-hidden="true" />
      <div className="portal-gate-vignette" aria-hidden="true" />

      <header className="portal-gate-brand">airsup</header>

      <section className="portal-gate-stage" aria-label="portal entry">
        <p className="portal-gate-eyebrow">cross the</p>
        <h1 className="portal-gate-title">veil</h1>
        <div className="portal-gate-rule" aria-hidden="true" />
        <p className="portal-gate-whisper">a door into the ai-net</p>
      </section>

      <nav className="portal-gate-paths" aria-label="choose your path">
        <GatePath
          label="with chatgpt"
          href="/portal/chatgpt"
          icon={<ChatGptBrandIcon className="portal-gate-logo portal-gate-logo--chatgpt" />}
        />
        <GatePath
          label="with claude"
          soon
          icon={<ClaudeBrandIcon className="portal-gate-logo portal-gate-logo--claude" />}
        />
      </nav>

      <footer className="portal-gate-footer">truth · love · courage</footer>
    </main>
  );
}
