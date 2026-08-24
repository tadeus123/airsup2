const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeOrgoComputerId(raw: string): string | null {
  const id = raw.trim();
  if (!id) return null;
  if (!UUID_RE.test(id)) {
    throw new Error("Orgo computer ID must be a UUID (from Orgo General settings)");
  }
  return id;
}

export function orgoRelayEnabled(): boolean {
  return Boolean((process.env.ORGO_API_KEY || "").trim());
}
