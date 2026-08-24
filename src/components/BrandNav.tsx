"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("airsup-theme") || window.localStorage.getItem("ainet-theme");
    const next = saved === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("airsup-theme", next);
  }

  return (
    <button type="button" className="as-theme" onClick={toggle} aria-label="Toggle theme">
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
        </svg>
      )}
    </button>
  );
}

export function BrandMark({ href = "/airsup" }: { href?: string }) {
  return (
    <Link href={href} className="as-mark" aria-label="Airsup home">
      AIRSUP
    </Link>
  );
}

export function BrandNav({
  links = true,
  actions,
}: {
  links?: boolean;
  actions?: ReactNode;
}) {
  const pathname = usePathname() || "";
  const item = (href: string, label: string) => {
    const on =
      href === "/company"
        ? pathname.startsWith("/company")
        : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link href={href} className={on ? "as-nav-link on" : "as-nav-link"}>
        {label}
      </Link>
    );
  };

  return (
    <header className="as-header">
      <div className="as-header-inner">
        <BrandMark href="/airsup" />
        {links ? (
          <nav className="as-nav-links" aria-label="Primary">
            {item("/airsup", "People")}
            {item("/company", "Company")}
          </nav>
        ) : null}
        <div className="as-header-actions">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
