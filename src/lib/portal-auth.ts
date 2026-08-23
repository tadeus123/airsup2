import { authUserFromRequest, type User } from "./users";

export function portalAuthRequest(token: string, path = "/api/portal"): Request {
  return new Request(`http://portal.local${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function authPortalUser(token: string): Promise<User> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Unauthorized");
  return authUserFromRequest(portalAuthRequest(trimmed));
}

export function bearerFromRequest(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return (match?.[1] || "").trim();
}
