import { randomBytes } from "node:crypto";
import {
  claimMemberNumber,
  normalizeUsername,
  registerUser,
  type User,
} from "./users";

/** Silent portal signup — no form, no token shown to the user. */
export async function registerPortalUser(): Promise<{ user: User; token: string }> {
  const memberNumber = await claimMemberNumber();
  const suffix = randomBytes(3).toString("hex");
  const username = normalizeUsername(`p${memberNumber}-${suffix}`);
  const { user, token } = await registerUser({
    username,
    displayName: username,
    memberNumber,
  });
  return { user, token };
}
