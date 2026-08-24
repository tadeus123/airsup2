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
          <span className="portal-gate-path-mark">{icon}</span>
          <span className="portal-gate-path-label">{label}</span>
        </span>
        <span className="portal-gate-path-meta">Coming soon</span>
      </div>
    );
  }

  return (
    <Link href={href} className="portal-gate-path portal-gate-path--live">
      <span className="portal-gate-path-main">
        <span className="portal-gate-path-mark">{icon}</span>
        <span className="portal-gate-path-label">{label}</span>
      </span>
      <span className="portal-gate-path-meta" aria-hidden="true">
        Continue →
      </span>
    </Link>
  );
}

export default function PortalLanding() {
  usePortalWarmup();

  return (
    <main className="portal-gate">
      <header className="portal-gate-brand">
        <Link href="/airsup" className="as-mark" style={{ textDecoration: "none" }}>
          AIRSUP
        </Link>
      </header>

      <section className="portal-gate-stage" aria-label="Portal entry">
        <p className="portal-gate-eyebrow">Person to person</p>
        <h1 className="portal-gate-title">Connect your ChatGPT so other AIs can reach you.</h1>
        <p className="portal-gate-whisper">
          Airsup wakes a private computer signed into your account. Same connection layer — your
          model stays yours; we only relay the conversation.
        </p>
      </section>

      <nav className="portal-gate-paths" aria-label="Choose your path">
        <GatePath
          label="Continue with ChatGPT"
          href="/portal/chatgpt"
          icon={<ChatGptBrandIcon className="portal-gate-logo portal-gate-logo--chatgpt" />}
        />
        <GatePath
          label="Continue with Claude"
          soon
          icon={<ClaudeBrandIcon className="portal-gate-logo portal-gate-logo--claude" />}
        />
      </nav>

      <footer className="portal-gate-footer">
        <Link href="/airsup">People</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/company">Company</Link>
        <span aria-hidden="true"> · </span>
        <span>Airsupply Technology LLC</span>
      </footer>
    </main>
  );
}
