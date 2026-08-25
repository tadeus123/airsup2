"use client";

import { type FormEvent, useState } from "react";
import {
  getSavedPortalToken,
  submitPortalLogin,
  submitPortalLogin2fa,
} from "@/lib/portal-client";

type Props = {
  /** False while Orgo/ChatGPT login is still warming up in the background. */
  desktopReady?: boolean;
  /** Resolves when the desktop is ready for credential submit. */
  waitForDesktop?: () => Promise<void>;
  onSigning?: (busy: boolean) => void;
  onSignedIn?: () => void;
};

type Step = "credentials" | "totp" | "done";

export default function ChatGptNativeLoginForm({
  desktopReady = true,
  waitForDesktop,
  onSigning,
  onSignedIn,
}: Props) {
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
      if (!desktopReady && waitForDesktop) {
        await waitForDesktop();
      }
      const token = getSavedPortalToken();
      if (!token) throw new Error("session expired — refresh and try again");
      const result = await submitPortalLogin(token, email.trim(), password);
      if (result.status === "signed_in") {
        setPassword("");
        setStep("done");
        onSignedIn?.();
        return;
      }
      if (result.status === "needs_2fa") {
        setPassword("");
        setThreadId(result.threadId);
        setStep("totp");
        setError("");
        return;
      }
      // Wrong password / other fail — stay on credentials so they can retry.
      setPassword("");
      setError(result.message);
    } catch (err) {
      setPassword("");
      setError(err instanceof Error ? err.message : "could not connect");
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
        onSignedIn?.();
        return;
      }
      if (result.status === "needs_2fa") {
        setThreadId(result.threadId);
        setCode("");
        setError(result.message);
        return;
      }
      // Not a real ChatGPT authenticator prompt / invalid — go back to credentials.
      const msg = result.message || "could not verify";
      setCode("");
      setThreadId("");
      setStep("credentials");
      setError(
        /not a chatgpt authenticator|wrong password/i.test(msg)
          ? msg
          : `${msg} — try connecting again with email and password`
      );
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
        <p className="oauth-login-status">Connected</p>
      </div>
    );
  }

  if (step === "totp") {
    return (
      <form className="oauth-login-form" onSubmit={(e) => void onSubmitTotp(e)}>
        <label className="co-field">
          <span>ChatGPT authenticator code</span>
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
        <button
          type="button"
          className="as-btn-ghost"
          disabled={busy}
          onClick={() => {
            setStep("credentials");
            setCode("");
            setThreadId("");
            setError("Try your ChatGPT email and password again");
          }}
        >
          Back to email & password
        </button>
      </form>
    );
  }

  return (
    <form className="oauth-login-form" onSubmit={(e) => void onSubmitCredentials(e)}>
      <label className="co-field">
        <span>Your ChatGPT email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </label>
      <label className="co-field">
        <span>Your ChatGPT password</span>
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
        {busy
          ? desktopReady
            ? "…"
            : "Waiting for ChatGPT…"
          : desktopReady
            ? "Connect"
            : "Connect when ready"}
      </button>
      {!desktopReady && !busy ? (
        <p className="oauth-login-prep">Desktop is opening ChatGPT in the background…</p>
      ) : null}
    </form>
  );
}
