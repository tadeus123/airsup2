"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
        <h2 id={titleId}>Company login</h2>
        <p className="ainet-muted">Sign in with your domain and password.</p>

        <label className="co-field">
          <span>Domain</span>
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
          <span>Password</span>
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
            Cancel
          </button>
          <button type="submit" className="co-go" disabled={busy}>
            {busy ? "…" : "Sign in"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** @deprecated Prefer BrandNav + CompanyLoginDialog */
export function CompanyNav({
  showLogin = false,
}: {
  subtitle?: string;
  showLogin?: boolean;
}) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <>
      {showLogin ? (
        <button type="button" className="as-btn-ghost" onClick={() => setLoginOpen(true)}>
          Log in
        </button>
      ) : null}
      {showLogin ? (
        <CompanyLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      ) : null}
    </>
  );
}
