import {
  mcpResourceUrl,
  publicOrigin,
  OAUTH_SCOPE,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadata(request: Request) {
  const origin = publicOrigin(request);
  const resource = mcpResourceUrl(origin);
  return {
    resource,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/airsup`,
  };
}

export async function GET(request: Request) {
  return Response.json(metadata(request), {
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
