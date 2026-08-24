/**
 * Static + unit checks for P2P/P2C MCP isolation (no live Orgo).
 * Run: node --import tsx scripts/scope-check.ts
 */
import { PLUGIN_TOOL_NAMES } from "../src/lib/chatgpt-onboarding";
import {
  COMPANY_CONV_PREFIX,
  companyConversationGuard,
  companyDomainGuard,
  isCompanyConversationId,
  isPeerConversationId,
  looksLikeDomain,
  mintCompanyConversationId,
  normalizeCompanyConversationId,
  peerConversationGuard,
} from "../src/lib/conversation-scope";
import { buildWakePrompt } from "../src/lib/orgo-wake-relay";
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

section("Tool registry parity");
const mcpSrc = readFileSync("src/lib/mcp-server.ts", "utf8");
const registered = [
  ...mcpSrc.matchAll(/server\.registerTool\(\s*\n?\s*"([^"]+)"/g),
].map((m) => m[1]);
const expected = [...PLUGIN_TOOL_NAMES];
registered.sort();
expected.sort();
assert(registered.length === 11, `expected 11 tools, got ${registered.length}`);
assert(
  JSON.stringify(registered) === JSON.stringify(expected),
  `tool mismatch\n  registered: ${registered.join(", ")}\n  plugin list: ${expected.join(", ")}`
);
console.log("OK all 11 PLUGIN_TOOL_NAMES match registerTool()");

section("Company conversation IDs");
const coId = mintCompanyConversationId();
assert(coId.startsWith(COMPANY_CONV_PREFIX), "mint uses co: prefix");
assert(isCompanyConversationId(coId), "isCompanyConversationId");
assert(!isPeerConversationId(coId), "co id is not peer");
assert(normalizeCompanyConversationId(coId) === coId, "normalize co id");
let threw = false;
try {
  normalizeCompanyConversationId("550e8400-e29b-41d4-a716-446655440000");
} catch {
  threw = true;
}
assert(threw, "bare peer UUID rejected for company normalize");
console.log("OK company id mint/normalize");

section("Peer vs company guards");
const peerUuid = "550e8400-e29b-41d4-a716-446655440000";
assert(
  peerConversationGuard(coId, "talk_to_user")?.includes("talk_to_company"),
  "co id blocked on talk_to_user"
);
assert(
  peerConversationGuard("acme.com", "await_reply")?.includes("talk_to_company"),
  "domain blocked on await_reply"
);
assert(
  companyConversationGuard(peerUuid)?.includes("peer thread"),
  "peer uuid blocked on talk_to_company"
);
assert(
  companyDomainGuard("blackbird.care", "lookup_user")?.includes("talk_to_company"),
  "domain blocked on lookup_user"
);
assert(companyConversationGuard(undefined) === null, "empty conv ok for company");
assert(peerConversationGuard(undefined, "reply_to_user") === null, "empty conv ok for peer");
console.log("OK all guard matrix cases");

section("Wake prompt uses reply_to_user");
const wake = buildWakePrompt("tade1", 184);
assert(wake.includes("reply_to_user"), "wake mentions reply_to_user");
assert(wake.includes("Do not use talk_to_user"), "wake warns against talk_to_user");
console.log("OK wake prompt");

section("MCP guard coverage in source");
const guardCalls = [
  'companyDomainGuard(username, "lookup_user")',
  "companyConversationGuard(conversation_id)",
  'companyDomainGuard(to, "reply_to_user")',
  'peerConversationGuard(conversation_id, "reply_to_user")',
  'companyDomainGuard(to, "talk_to_user")',
  'peerConversationGuard(conversation_id, "talk_to_user")',
  'peerConversationGuard(cid, "await_reply")',
  'companyDomainGuard(args.from, "await_reply")',
  'peerConversationGuard(conversation_id, "cancel_wait")',
];
for (const call of guardCalls) {
  assert(mcpSrc.includes(call), `mcp-server should include ${call}`);
}
assert(mcpSrc.includes("Cannot message yourself"), "self-message block");
assert(mcpSrc.includes('channel: "peer"'), "peer channel in responses");
assert(mcpSrc.includes('channel: "company"'), "company channel in responses");
assert(mcpSrc.includes('next_action: "reply_to_user"'), "inbound next_action");
assert(looksLikeDomain("acme.com"), "acme.com is domain");
assert(looksLikeDomain("blackbird.care"), "blackbird.care is domain");
assert(!looksLikeDomain("tade1"), "username is not domain");
console.log("OK guard calls present in mcp-server.ts");

console.log("\n=== ALL SCOPE CHECKS PASSED ===\n");
