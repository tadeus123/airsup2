"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

export function CompanyLoginDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [domain, setDomain] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setError("");
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/company/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, password }),
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || "login failed");
      onClose();
      router.push(`/company/d/${json.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="co-login-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <form className="co-login-panel" onSubmit={(e) => void onSubmit(e)}>
        <h2 id={titleId}>company login</h2>
        <p className="ainet-muted">domain + password. no email.</p>

        <label className="co-field">
          <span>domain</span>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            required
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>

        <label className="co-field">
          <span>password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={busy}
            autoComplete="current-password"
          />
        </label>

        {error ? <p className="ainet-note err">{error}</p> : null}

        <div className="co-login-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button type="submit" className="co-go" disabled={busy}>
            {busy ? "…" : "enter"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function CompanyNav({
  subtitle,
  showLogin = false,
}: {
  subtitle?: string;
  showLogin?: boolean;
}) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      <nav className="ainet-nav co-nav" aria-label="airsup">
        <Link href="/company" className="ainet-title">
          airsup
        </Link>
        <CompanyThemeToggle />
        {subtitle ? <span className="co-nav-sub">{subtitle}</span> : null}
        {showLogin ? (
          <button
            type="button"
            className="co-nav-login"
            onClick={() => setLoginOpen(true)}
          >
            login
          </button>
        ) : null}
      </nav>
      {showLogin ? (
        <CompanyLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      ) : null}
    </>
  );
}
