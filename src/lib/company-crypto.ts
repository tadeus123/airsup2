import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyMaterial(): Buffer {
  const secret = process.env.AIRSUP_DB_TOKEN || "airsup-local-company-key";
  return createHash("sha256").update(`${secret}:company-api-keys`).digest();
}

export function encryptCompanyApiKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptCompanyApiKey(packed: string): string {
  const parts = packed.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) {
    throw new Error("company api key is not readable");
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const enc = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function companyKeyLast4(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.slice(-4);
}

export function hashCompanyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintCompanyToken(): { token: string; hash: string; prefix: string } {
  const token = `aco_${randomBytes(24).toString("hex")}`;
  return {
    token,
    hash: hashCompanyToken(token),
    prefix: token.slice(0, 10),
  };
}

export function assertOpenAiKey(raw: string): string {
  const key = raw.trim();
  if (!key) throw new Error("paste your openai api key");
  if (key.startsWith("sk-ant-")) {
    throw new Error("claude keys come later — for now use an openai key (starts with sk-)");
  }
  if (!key.startsWith("sk-")) {
    throw new Error("that does not look like an openai api key");
  }
  if (key.length < 20) throw new Error("api key looks too short");
  return key;
}
