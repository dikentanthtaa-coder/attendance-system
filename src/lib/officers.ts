import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { ApiError } from "./api";
import { writeAudit } from "./attendance";
import type { SessionUser } from "./auth";
import { getSql, isUniqueViolation } from "./db";
import { generatePassword, passwordSchema } from "./passwords";
import { normalizeMobile, normalizeName } from "./shared";

// Registration is open to anyone with the link, so this limits how fast accounts can be created.
// It is high enough for a whole team registering together.
const MAX_REGISTRATIONS_PER_WINDOW = 100;
const WINDOW_MINUTES = 10;

const personName = (label: string) =>
  z.string().max(60, `${label} is too long.`).transform(normalizeName).pipe(z.string().min(1, `${label} is required.`));

export const registrationSchema = z
  .object({
    firstName: personName("First name"),
    lastName: personName("Last name"),
    mobile: z.string().transform((v, ctx) => {
      const mobile = normalizeMobile(v);
      if (!mobile) {
        ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
        return z.NEVER;
      }
      return mobile;
    }),
    email: z.string().max(200, "Email is too long.").trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, "Password and Confirm Password don't match.");

const ALREADY_EMAIL = "This email is already registered. Log in, or use a different email.";
const ALREADY_MOBILE = "This mobile number is already registered. Log in, or use a different number.";

export async function registerOfficer(input: z.output<typeof registrationSchema>) {
  const sql = getSql();

  const [{ recent }] = await sql`
    select count(*)::int as recent from app_users
    where role = 'officer' and created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
  if (recent >= MAX_REGISTRATIONS_PER_WINDOW) {
    throw new ApiError(429, "too_many_registrations", "Too many registrations right now. Please try again in a few minutes.");
  }

  const [taken] = await sql`
    select email = ${input.email} as email_taken from app_users
    where email = ${input.email} or mobile = ${input.mobile} limit 1`;
  if (taken) throw new ApiError(409, "already_registered", taken.email_taken ? ALREADY_EMAIL : ALREADY_MOBILE);

  const hash = await bcrypt.hash(input.password, 12);
  try {
    const [officer] = await sql`
      insert into app_users (username, display_name, first_name, last_name, mobile, email, password_hash, role, approval_status)
      values (${input.email}, ${`${input.firstName} ${input.lastName}`}, ${input.firstName}, ${input.lastName},
              ${input.mobile}, ${input.email}, ${hash}, 'officer', 'pending')
      returning id, username`;
    await writeAudit(sql, officer as unknown as Pick<SessionUser, "id" | "username">, "officer.register", officer.id, { mobile: input.mobile });
  } catch (err) {
    // Two people submitting at the same moment both pass the check above; the index decides.
    if (isUniqueViolation(err, "app_users_mobile_key")) throw new ApiError(409, "already_registered", ALREADY_MOBILE);
    if (isUniqueViolation(err, "app_users_email_key") || isUniqueViolation(err, "app_users_username_key")) {
      throw new ApiError(409, "already_registered", ALREADY_EMAIL);
    }
    throw err;
  }
}

const PAGE_SIZE = 50;

export async function listOfficers(q: string, status: string, page: number) {
  const sql = getSql();
  const text = q.trim().replace(/[\\%_]/g, "\\$&");
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, 5);
  const nameMatch = tokens.reduce((acc, t) => sql`${acc} and display_name ilike ${`%${t}%`}`, sql`true`);

  // The fixed accounts this replaced are switched off for good, so they aren't listed.
  let where = sql`role = 'officer' and is_active`;
  if (text) where = sql`${where} and (email ilike ${`%${text}%`} or mobile like ${`%${text}%`} or (${nameMatch}))`;
  if (status === "pending" || status === "approved" || status === "rejected") where = sql`${where} and approval_status = ${status}`;

  const [officers, [{ total }], [{ pending }]] = await Promise.all([
    sql`
      select id, display_name, mobile, email, approval_status, created_at
      from app_users where ${where}
      order by approval_status = 'pending' desc, created_at desc, id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    sql`select count(*)::int as total from app_users where ${where}`,
    countPendingOfficers(),
  ]);
  return { officers, total, pending, page, pageSize: PAGE_SIZE };
}

export function countPendingOfficers() {
  return getSql()`
    select count(*)::int as pending from app_users
    where role = 'officer' and is_active and approval_status = 'pending'`;
}

export const reviewSchema = z.object({ action: z.enum(["approve", "reject"]) });

/** Takes effect at once: every request re-reads the status, so a removed officer is out on their next click. */
export async function reviewOfficer(admin: SessionUser, id: string, action: "approve" | "reject") {
  const sql = getSql();
  const status = action === "approve" ? "approved" : "rejected";
  const [officer] = await sql`
    update app_users
    set approval_status = ${status}, reviewed_at = now(), reviewed_by = ${admin.id}, failed_attempts = 0, locked_until = null
    where id = ${id} and role = 'officer' and is_active
    returning id, display_name`;
  if (!officer) throw new ApiError(404, "not_found", "This officer no longer exists.");
  await writeAudit(sql, admin, `officer.${action}`, id, { name: officer.display_name });
  return { name: officer.display_name as string, status };
}

/**
 * The temporary password is returned once, for Admin to pass on. Only its hash is stored, and it is
 * never written to the audit log. Raising the session version signs out any device still logged in.
 */
export async function resetOfficerPassword(admin: SessionUser, id: string) {
  const sql = getSql();
  const temporaryPassword = generatePassword();
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const [officer] = await sql`
    update app_users
    set password_hash = ${hash}, must_change_password = true, session_version = session_version + 1,
        failed_attempts = 0, locked_until = null
    where id = ${id} and role = 'officer' and is_active and approval_status = 'approved'
    returning display_name`;
  if (!officer) throw new ApiError(404, "not_found", "Only an approved officer's password can be reset.");
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
