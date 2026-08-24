import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

function keyMaterial(purpose: string): Buffer {
  const secret = process.env.AIRSUP_DB_TOKEN || "airsup-local-company-key";
  return createHash("sha256").update(`${secret}:${purpose}`).digest();
}

function packAes(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(purpose), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function unpackAes(packed: string, purpose: string): string {
  const parts = packed.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) {
    throw new Error("company secret is not readable");
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const enc = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function encryptCompanyApiKey(plain: string): string {
  return packAes(plain, "company-api-keys");
}

export function decryptCompanyApiKey(packed: string): string {
  try {
    return unpackAes(packed, "company-api-keys");
  } catch {
    throw new Error("company api key is not readable");
  }
}

export function encryptDashboardToken(token: string): string {
  return packAes(token, "company-dashboard-tokens");
}

export function decryptDashboardToken(packed: string): string {
  try {
    return unpackAes(packed, "company-dashboard-tokens");
  } catch {
    throw new Error("dashboard login is not readable");
  }
}

export function assertCompanyPassword(raw: string): string {
  const password = raw.trim();
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  if (password.length > 128) throw new Error("password is too long");
  return password;
}

export function hashCompanyPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(assertCompanyPassword(password), salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyCompanyPassword(password: string, packed: string): boolean {
  if (!packed || !packed.startsWith("scrypt:")) return false;
  const parts = packed.split(":");
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password.trim(), salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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

export function assertCompanyApiKey(raw: string): string {
  const key = raw.trim();
  if (!key) throw new Error("paste your openai or claude api key");
  if (key.startsWith("sk-ant-")) {
    if (key.length < 20) throw new Error("claude api key looks too short");
    return key;
  }
  if (key.startsWith("sk-")) {
    if (key.length < 20) throw new Error("openai api key looks too short");
    return key;
  }
  throw new Error("use an openai key (sk-…) or a claude key (sk-ant-…)");
}

/** @deprecated use assertCompanyApiKey */
export function assertOpenAiKey(raw: string): string {
  return assertCompanyApiKey(raw);
}

export function companyApiProvider(apiKey: string): "openai" | "anthropic" {
  return apiKey.trim().startsWith("sk-ant-") ? "anthropic" : "openai";
}
