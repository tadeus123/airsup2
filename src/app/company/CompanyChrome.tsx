"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function CompanyThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("ainet-theme");
    const next = saved === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("ainet-theme", next);
  }

  return (
    <button type="button" className="ainet-theme" onClick={toggle} aria-label="Toggle theme">
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
          <path d="M21 14.3A8.5 8.5 0 0 1 9.7 3 7 7 0 1 0 21 14.3z" />
        </svg>
      )}
    </button>
  );
}

export function CompanyNav({ subtitle }: { subtitle?: string }) {
  return (
    <nav className="ainet-nav" aria-label="airsup">
      <Link href="/company" className="ainet-title">
        airsup
      </Link>
      <CompanyThemeToggle />
      {subtitle ? <span className="co-nav-sub">{subtitle}</span> : null}
    </nav>
  );
}
