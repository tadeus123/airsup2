import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAirsupMcpServer } from "@/lib/mcp-server";
import { authMcpUser, mcpResourceUrl, publicOrigin } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, authorization, x-airsup-token, mcp-session-id, accept",
    "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unauthorized(request: Request): Response {
  const origin = publicOrigin(request);
  // Path-aware metadata URL matches resource https://…/mcp (RFC 9728)
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const resource = mcpResourceUrl(origin);
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Unauthorized. Connect with OAuth using the universal MCP URL, or use a legacy /mcp/asp_… URL.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": `Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="${resourceMetadata}", resource="${resource}"`,
      },
    }
  );
}

async function handleMcp(request: Request): Promise<Response> {
  const started = Date.now();
  let user;
  try {
    user = await authMcpUser(request);
  } catch {
    return withCors(unauthorized(request));
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  });
  const server = createAirsupMcpServer(user);
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const totalMs = Date.now() - started;
  if (totalMs > 50) {
    console.info(
      JSON.stringify({
        airsup_mcp: true,
        username: user.username,
        method: request.method,
        total_ms: totalMs,
      })
    );
  }
  return withCors(response);
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

export async function GET(request: Request) {
  return handleMcp(request);
}

export async function POST(request: Request) {
  return handleMcp(request);
}

export async function DELETE(request: Request) {
  return handleMcp(request);
}
