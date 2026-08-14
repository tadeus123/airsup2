import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAirsupMcpServer } from "@/lib/mcp-server";
import { authUserFromRequest } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, authorization, x-airsup-token, mcp-session-id, accept",
    "Access-Control-Expose-Headers": "mcp-session-id",
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

function jsonRpcUnauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Unauthorized. Set Authentication to No Auth and use Server URL with ?token=asp_...",
      },
      id: null,
    }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}

async function resolveUser(request: Request) {
  try {
    return await authUserFromRequest(request);
  } catch {
    // try query token
  }
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) throw new Error("Unauthorized");
  const forged = new Request(request.url, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      authorization: `Bearer ${token}`,
    },
  });
  return authUserFromRequest(forged);
}

async function handleMcp(request: Request): Promise<Response> {
  const started = Date.now();
  let user;
  try {
    user = await resolveUser(request);
  } catch {
    return withCors(jsonRpcUnauthorized());
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
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
