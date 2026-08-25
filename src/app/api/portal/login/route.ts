import { NextResponse } from "next/server";
import {
  continueChatGptLoginOnDesktop,
  fillChatGptLoginOnDesktop,
  getChatGptAuthState,
  orgoProvisionConfigured,
} from "@/lib/orgo-provision";
import { chatgptReadyCookieHeader } from "@/lib/oauth-setup";
import { authPortalUser, bearerFromRequest, portalAuthRequest } from "@/lib/portal-auth";
import { authUserFromRequestFresh } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function signedInResponse(username: string) {
  const res = NextResponse.json(
    { ok: true, status: "signed_in" },
    { headers: { "Cache-Control": "no-store" } }
  );
  res.headers.append("set-cookie", chatgptReadyCookieHeader(username));
  return res;
}

async function resolveComputerId(token: string): Promise<string> {
  // Orgo may still be linking when the form is already visible — retry briefly.
  for (let i = 0; i < 12; i++) {
    const user = await authUserFromRequestFresh(portalAuthRequest(token));
    const id = (user.orgoComputerId || "").trim();
    if (id) return id;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "";
}

export async function GET(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);
    const computerId = (user.orgoComputerId || "").trim();
    if (!computerId) {
      return NextResponse.json({ ok: true, loggedIn: false });
    }
    const state = await getChatGptAuthState(computerId);
    return NextResponse.json({
      ok: true,
      loggedIn: state.loggedIn,
      url: state.url,
    });
  } catch {
    return NextResponse.json({ ok: true, loggedIn: false });
  }
}

export async function POST(request: Request) {
  try {
    const token = bearerFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await authPortalUser(token);
    const computerId = (user.orgoComputerId || "").trim() || (await resolveComputerId(token));
    if (!computerId) {
      return NextResponse.json(
        {
          error: "not_ready",
          message: "Desktop is still starting — wait a few seconds and press Connect again.",
        },
        { status: 503 }
      );
    }
    if (!orgoProvisionConfigured()) {
      return NextResponse.json({ error: "orgo_not_configured" }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      code?: string;
      threadId?: string;
    };

    // Step 2: continue with authenticator / 2FA code
    const code = (body.code || "").replace(/\s+/g, "").trim();
    const threadId = (body.threadId || "").trim();
    if (code || threadId) {
      if (!/^\d{6,8}$/.test(code)) {
        return NextResponse.json(
          { error: "invalid_code", message: "enter the 6-digit authenticator code" },
          { status: 400 }
        );
      }
      if (!threadId) {
        return NextResponse.json(
          { error: "missing_thread", message: "2fa session expired — sign in again" },
          { status: 400 }
        );
      }
      const continued = await continueChatGptLoginOnDesktop(computerId, threadId, code);
      if (continued.status === "signed_in") {
        return signedInResponse(user.username);
      }
      if (continued.status === "needs_2fa") {
        return NextResponse.json(
          {
            ok: false,
            status: "needs_2fa",
            threadId: continued.threadId || threadId,
            message: "that code did not work — try the next code from your authenticator app",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          message: /wrong password/i.test(continued.message)
            ? "wrong password — try again"
            : continued.message.slice(0, 220) || "could not finish 2fa",
        },
        { status: 400 }
      );
    }

    // Step 1: email + password
    const email = (body.email || "").trim();
    const password = body.password || "";
    if (!email || !password) {
      return NextResponse.json(
        { error: "missing_credentials", message: "email and password are required" },
        { status: 400 }
      );
    }
    if (email.length > 254 || password.length > 200) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
    }

    const result = await fillChatGptLoginOnDesktop(computerId, email, password);

    if (result.status === "signed_in") {
      return signedInResponse(user.username);
    }

    if (result.status === "needs_2fa") {
      if (!result.threadId) {
        return NextResponse.json(
          {
            ok: false,
            status: "failed",
            message:
              "chatgpt asked for 2fa but the login session could not continue — try sign-in again",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          status: "needs_2fa",
          threadId: result.threadId,
          message: "chatgpt wants your authenticator code",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: /wrong password/i.test(result.message)
          ? "wrong password — try again"
          : result.message.slice(0, 220) || "could not finish chatgpt login",
      },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "login_failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
