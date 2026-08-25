/**
 * Person↔person Orgo desktop during OAuth connect.
 *
 * Currently on ice: OAuth is Name → Connect → back to ChatGPT (no VM / ChatGPT login).
 * Flip this to true (or set AIRSUP_OAUTH_ORGO_CONNECT=1) to restore full Orgo warm + login.
 * All Orgo routes/libs stay in the repo — this gate only controls whether OAuth uses them.
 */
export const OAUTH_ORGO_CONNECT_ENABLED = false;

export function oauthOrgoConnectEnabled(): boolean {
  const env = (process.env.AIRSUP_OAUTH_ORGO_CONNECT || "").trim();
  if (env === "1" || /^true$/i.test(env)) return true;
  if (env === "0" || /^false$/i.test(env)) return false;
  return OAUTH_ORGO_CONNECT_ENABLED;
}
