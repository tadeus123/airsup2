import { authorizationServerMetadata, publicOrigin } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Path-aware discovery: ChatGPT fetches .../oauth-authorization-server/mcp for /mcp resources. */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  return Response.json(authorizationServerMetadata(origin), {
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
