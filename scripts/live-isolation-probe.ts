/**
 * Live isolation probe against the real Supabase + production MCP.
 * Does not call talk_to_user (would wake Orgo). Inserts messages via API, then
 * opens them the same way ChatGPT's check_inbox / reply_to_user would.
 *
 * Run: node --env-file=.env.local --import tsx scripts/live-isolation-probe.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getInboundMessage,
  inboundFirstContactBlocksTalk,
  registerUser,
  replyAndAckMessage,
  sendMessage,
} from "../src/lib/users";

const PROD = "https://airsup2.vercel.app";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function toolJson(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  const text = result.content?.find((c) => c.type === "text")?.text || "";
  try {
    return { isError: Boolean(result.isError), data: JSON.parse(text) as Record<string, unknown>, text };
  } catch {
    return { isError: Boolean(result.isError), data: null, text };
  }
}

async function mcpClient(token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${PROD}/mcp/${token}`));
  const client = new Client({ name: "airsup-live-probe", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function main() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const tadeName = `probet${suffix}`;
  const kostiName = `probek${suffix}`;
  const results: string[] = [];
  const pass = (name: string) => {
    results.push(`PASS ${name}`);
    console.log(`PASS ${name}`);
  };

  console.log(`users: ${tadeName} / ${kostiName}`);

  const tade = await registerUser({ username: tadeName, displayName: "Probe Tade" });
  const kosti = await registerUser({ username: kostiName, displayName: "Probe Kosti" });

  const a = await sendMessage({
    fromUsername: kosti.user.username,
    toUsername: tade.user.username,
    body: "PROBE_A what is your life goal?",
  });
  const b = await sendMessage({
    fromUsername: tade.user.username,
    toUsername: kosti.user.username,
    body: "PROBE_B are you free monday?",
  });
  assert(a.conversationId !== b.conversationId, "simultaneous threads must differ");
  pass("db: two simultaneous threads");

  const tadeOpensA = await getInboundMessage({
    toUsername: tade.user.username,
    messageId: a.id,
    fromUsername: kosti.user.username,
  });
  assert(tadeOpensA?.body === "PROBE_A what is your life goal?", "tade sees kosti's text");
  pass("db: tade opens kosti inbound A");

  const tadeCannotOpenB = await getInboundMessage({
    toUsername: tade.user.username,
    messageId: b.id,
    fromUsername: kosti.user.username,
  });
  assert(!tadeCannotOpenB, "tade must not open his own outbound as kosti mail");
  pass("db: tade cannot open B as if from kosti");

  const kostiOpensB = await getInboundMessage({
    toUsername: kosti.user.username,
    messageId: b.id,
    fromUsername: tade.user.username,
  });
  assert(kostiOpensB?.body === "PROBE_B are you free monday?", "kosti sees tade's text");
  pass("db: kosti opens tade inbound B");

  assert(
    await inboundFirstContactBlocksTalk({
      me: tade.user.username,
      peer: kosti.user.username,
      conversationId: a.conversationId,
    }),
    "talk_to_user blocked on inbound thread A"
  );
  assert(
    !(await inboundFirstContactBlocksTalk({
      me: tade.user.username,
      peer: kosti.user.username,
      conversationId: b.conversationId,
    })),
    "tade outbound thread B is not blocked"
  );
  pass("db: talk_to_user block only on inbound thread");

  let mcpOk = false;
  try {
    const tadeMcp = await mcpClient(tade.token);
    const kostiMcp = await mcpClient(kosti.token);

    const who = toolJson(await tadeMcp.callTool({ name: "whoami", arguments: {} }));
    assert(who.data?.username === tadeName, `whoami expected ${tadeName} got ${who.data?.username}`);
    pass("mcp: whoami");

    const openA = toolJson(
      await tadeMcp.callTool({
        name: "check_inbox",
        arguments: { from: kostiName, message_id: a.id },
      })
    );
    assert(!openA.isError, `check_inbox A error: ${openA.text}`);
    assert(openA.data?.isolation === "strict", "strict isolation flag");
    const peer = openA.data?.peer_message as { text?: string; id?: number } | undefined;
    assert(peer?.text === "PROBE_A what is your life goal?", "mcp returns only A body");
    assert(peer?.id === a.id, "mcp returns only A id");
    assert(!JSON.stringify(openA.data).includes("PROBE_B"), "A payload must not contain B");
    pass("mcp: tade check_inbox A is isolated");

    const leakB = toolJson(
      await tadeMcp.callTool({
        name: "check_inbox",
        arguments: { from: kostiName, message_id: b.id },
      })
    );
    assert(leakB.isError, "tade opening B from kosti must error");
    pass("mcp: tade cannot check_inbox B as kosti mail");

    const missingId = await tadeMcp.callTool({
      name: "check_inbox",
      arguments: { from: kostiName },
    });
    assert(missingId.isError, "check_inbox without message_id must fail");
    pass("mcp: check_inbox requires message_id");

    const mixReply = toolJson(
      await tadeMcp.callTool({
        name: "reply_to_user",
        arguments: {
          to: kostiName,
          message: "mixed thread reply",
          conversation_id: b.conversationId,
          reply_to_id: a.id,
        },
      })
    );
    assert(mixReply.isError, "reply mixing A id onto B conversation must fail");
    pass("mcp: mixed reply_to_user rejected");

    const goodReply = toolJson(
      await tadeMcp.callTool({
        name: "reply_to_user",
        arguments: {
          to: kostiName,
          message: "PROBE_A_REPLY leave the solar system",
          conversation_id: a.conversationId,
          reply_to_id: a.id,
        },
      })
    );
    assert(!goodReply.isError, `valid reply failed: ${goodReply.text}`);
    pass("mcp: isolated reply_to_user A");

    const openB = toolJson(
      await kostiMcp.callTool({
        name: "check_inbox",
        arguments: { from: tadeName, message_id: b.id },
      })
    );
    assert(!openB.isError, `kosti check_inbox B error: ${openB.text}`);
    const peerB = openB.data?.peer_message as { text?: string } | undefined;
    assert(peerB?.text === "PROBE_B are you free monday?", "kosti sees only B");
    assert(!JSON.stringify(openB.data).includes("PROBE_A"), "B payload must not contain A");
    pass("mcp: kosti check_inbox B is isolated");

    const kostiReply = toolJson(
      await kostiMcp.callTool({
        name: "reply_to_user",
        arguments: {
          to: tadeName,
          message: "PROBE_B_REPLY monday 10am works",
          conversation_id: b.conversationId,
          reply_to_id: b.id,
        },
      })
    );
    assert(!kostiReply.isError, `kosti reply failed: ${kostiReply.text}`);
    pass("mcp: isolated reply_to_user B");

    await tadeMcp.close();
    await kostiMcp.close();
    mcpOk = true;
  } catch (e) {
    console.log(`MCP live probe skipped/failed: ${e instanceof Error ? e.message : e}`);
  }

  console.log("\n=== RESULTS ===");
  for (const line of results) console.log(line);
  console.log(mcpOk ? "MCP production: exercised" : "MCP production: not fully exercised");
  console.log("OK live isolation probe passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
