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
      <div className="portal-login-form portal-login-form--done">
        <p className="portal-login-status">signed in — chatgpt is ready on your private computer.</p>
        <p className="portal-connect-note">next visits on this computer should stay logged in.</p>
      </div>
    );
  }

  if (step === "totp") {
    return (
      <form className="portal-login-form" onSubmit={(e) => void onSubmitTotp(e)}>
        <p className="portal-login-hint">
          chatgpt wants your authenticator code — open your app and enter it here.
        </p>
        <label className="portal-login-field">
          <span className="portal-login-label">authenticator code</span>
          <input
            className="portal-login-input"
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
        {error ? <p className="portal-login-error">{error}</p> : null}
        <button type="submit" className="portal-login-submit" disabled={busy || code.length < 6}>
          {busy ? "verifying…" : "continue"}
        </button>
        <p className="portal-connect-note">
          airsup does not store this code — it is used once to finish sign-in.
        </p>
      </form>
    );
  }

  return (
    <form className="portal-login-form" onSubmit={(e) => void onSubmitCredentials(e)}>
      <p className="portal-login-hint">
        type here — orgo will open chatgpt and sign you in. do not type in the preview.
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
        if chatgpt asks for 2fa, we will ask for your authenticator code next. after the first
        sign-in, this computer usually stays logged in.
      </p>
    </form>
  );
}
