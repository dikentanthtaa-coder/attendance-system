import "server-only";
import bcrypt from "bcryptjs";
import { ApiError } from "./api";
import { writeAudit } from "./attendance";
import type { SessionUser } from "./auth";
import { getSql } from "./db";
import { generatePassword } from "./passwords";

/** The two fixed officer accounts. */
export async function listOfficers() {
  const officers = await getSql()`
    select id, username, display_name, gender_scope from app_users
    where role = 'officer' and is_active order by gender_scope desc`;
  return { officers };
}

/**
 * The temporary password is returned once, for Admin to pass on. Only its hash is stored, and it is
 * never written to the audit log. Raising the session version signs out every device on this account.
 */
export async function resetOfficerPassword(admin: SessionUser, id: string) {
  const sql = getSql();
  const temporaryPassword = generatePassword();
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const [officer] = await sql`
    update app_users
    set password_hash = ${hash}, must_change_password = true, session_version = session_version + 1,
        failed_attempts = 0, locked_until = null
    where id = ${id} and role = 'officer' and is_active
    returning display_name`;
  if (!officer) throw new ApiError(404, "not_found", "Only an officer's password can be reset here.");
  await writeAudit(sql, admin, "officer.password_reset", id, { name: officer.display_name });
  return { name: officer.display_name as string, temporaryPassword };
}

/** Replaces a temporary password. Returns the user as they now are, for a new session. */
export async function changeOwnPassword(user: SessionUser, password: string): Promise<SessionUser> {
  const sql = getSql();
  const [current] = await sql`select password_hash from app_users where id = ${user.id}`;
  if (await bcrypt.compare(password, current.password_hash)) {
    throw new ApiError(400, "same_password", "Choose a different password from the temporary one.");
  }
  const hash = await bcrypt.hash(password, 12);
  const [updated] = await sql`
    update app_users
    set password_hash = ${hash}, must_change_password = false, session_version = session_version + 1
    where id = ${user.id}
    returning session_version`;
  await writeAudit(sql, user, "auth.password_change", user.id);
  return { ...user, mustChangePassword: false, sessionVersion: updated.session_version };
}
