"use client";

import { type FormEvent, useState } from "react";
import {
  getSavedPortalToken,
  submitPortalLogin,
  submitPortalLogin2fa,
} from "@/lib/portal-client";

type Props = {
  onSigning?: (busy: boolean) => void;
};

type Step = "credentials" | "totp" | "done";

export default function ChatGptNativeLoginForm({ onSigning }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [threadId, setThreadId] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmitCredentials(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    onSigning?.(true);
    try {
      const token = getSavedPortalToken();
      if (!token) throw new Error("session expired — refresh and try again");
      const result = await submitPortalLogin(token, email.trim(), password);
      if (result.status === "signed_in") {
        setPassword("");
        setStep("done");
        return;
      }
      if (result.status === "needs_2fa") {
        setPassword("");
        setThreadId(result.threadId);
        setStep("totp");
        setError("");
        return;
      }
      setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not sign in");
    } finally {
      setBusy(false);
      onSigning?.(false);
    }
  }

  async function onSubmitTotp(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    onSigning?.(true);
    try {
      const token = getSavedPortalToken();
      if (!token) throw new Error("session expired — refresh and try again");
      const result = await submitPortalLogin2fa(token, threadId, code.trim());
      if (result.status === "signed_in") {
        setCode("");
        setStep("done");
        return;
      }
      if (result.status === "needs_2fa") {
        setThreadId(result.threadId);
        setCode("");
        setError(result.message);
        return;
      }
      setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not verify code");
    } finally {
      setBusy(false);
      onSigning?.(false);
    }
  }

  if (step === "done") {
    return (
      <div className="oauth-login-form oauth-login-form--done">
        <p className="oauth-login-status">Signed in</p>
      </div>
    );
  }

  if (step === "totp") {
    return (
      <form className="oauth-login-form" onSubmit={(e) => void onSubmitTotp(e)}>
        <label className="co-field">
          <span>2FA code</span>
          <input
            type="text"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,8}"
            maxLength={8}
            required
            value={code}
            disabled={busy}
            autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="123456"
          />
        </label>
        {error ? <p className="ainet-note err">{error}</p> : null}
        <button type="submit" className="co-go co-go--wide" disabled={busy || code.length < 6}>
          {busy ? "…" : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <form className="oauth-login-form" onSubmit={(e) => void onSubmitCredentials(e)}>
      <label className="co-field">
        <span>Email</span>
        <input
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
      <label className="co-field">
        <span>Password</span>
        <input
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
      {error ? <p className="ainet-note err">{error}</p> : null}
      <button type="submit" className="co-go co-go--wide" disabled={busy}>
        {busy ? "…" : "Sign in"}
      </button>
    </form>
  );
}
