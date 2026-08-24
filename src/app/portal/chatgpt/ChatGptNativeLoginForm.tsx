"use client";

import { type FormEvent, useState } from "react";
import { getSavedPortalToken, submitPortalLogin } from "@/lib/portal-client";

type Props = {
  onSigning?: (busy: boolean) => void;
};

export default function ChatGptNativeLoginForm({ onSigning }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    onSigning?.(true);
    try {
      const token = getSavedPortalToken();
      if (!token) throw new Error("session expired — refresh and try again");
      await submitPortalLogin(token, email.trim(), password);
      setDone(true);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not sign in");
    } finally {
      setBusy(false);
      onSigning?.(false);
    }
  }

  if (done) {
    return (
      <div className="portal-login-form portal-login-form--done">
        <p className="portal-login-status">signing you in on your private computer…</p>
        <p className="portal-connect-note">watch the window above — you should land in chatgpt.</p>
      </div>
    );
  }

  return (
    <form className="portal-login-form" onSubmit={(e) => void onSubmit(e)}>
      <p className="portal-login-hint">
        type here — we send it into your private computer. no need to fight the livestream.
      </p>
      <label className="portal-login-field">
        <span className="portal-login-label">email</span>
        <input
          className="portal-login-input"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
        />
      </label>
      <label className="portal-login-field">
        <span className="portal-login-label">password</span>
        <input
          className="portal-login-input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </label>
      {error ? <p className="portal-login-error">{error}</p> : null}
      <button type="submit" className="portal-login-submit" disabled={busy}>
        {busy ? "signing in…" : "sign in"}
      </button>
      <p className="portal-connect-note">
        airsup does not store your password — it is typed once into your private computer.
      </p>
    </form>
  );
}
