import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { getSql } from "./db";
import { normalizeMobile } from "./shared";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "officer";
  mustChangePassword: boolean;
  /** Raised when a password changes, which signs out every session issued before it. */
  sessionVersion: number;
};

const COOKIE = "att_session";
const SESSION_DAYS = 7; // long enough that nobody is logged out mid-event
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 2;

// Compared against when the username is unknown, so that response time doesn't reveal which usernames exist.
const DUMMY_HASH = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8qkfHmGQ0Hc7yqzQ0uKr0vX1b5lJ0K";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" | "locked" | "pending" | "rejected" };

/** Admin logs in with a username; an officer with their email or mobile number. */
export async function verifyLogin(identifierRaw: string, password: string): Promise<LoginResult> {
  const sql = getSql();
  const identifier = identifierRaw.trim().toLowerCase();
  const mobile = normalizeMobile(identifier);

  const [row] = await sql`
    select id, username, display_name, password_hash, role, is_active, approval_status,
           must_change_password, session_version,
           locked_until is not null and locked_until > now() as locked
    from app_users
    where username = ${identifier} or email = ${identifier} ${mobile ? sql`or mobile = ${mobile}` : sql``}
    limit 1`;

  if (!row) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: "invalid" };
  }
  if (row.locked) return { ok: false, reason: "locked" };

  const matches = await bcrypt.compare(password, row.password_hash);
  if (!matches || !row.is_active) {
    await sql`
      update app_users set
        failed_attempts = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS} then 0 else failed_attempts + 1 end,
        locked_until = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
                            then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
      where id = ${row.id}`;
    return { ok: false, reason: "invalid" };
  }

  await sql`update app_users set failed_attempts = 0, locked_until = null where id = ${row.id}`;
  // Only said after the right password, so this can't be used to look up who has registered.
  if (row.approval_status !== "approved") return { ok: false, reason: row.approval_status };
  return {
    ok: true,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      mustChangePassword: row.must_change_password,
      sessionVersion: row.session_version,
    },
  };
}

export async function startSession(user: SessionUser) {
  const token = await new SignJWT({ sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // browsers won't attach it to cross-site POSTs, which blocks CSRF
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/**
 * The cookie only proves identity. Role, approval and active status are always read from
 * the database, so a permission can't be claimed from the browser, and Admin removing an
 * officer takes effect on that officer's next request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  let userId: string | undefined;
  let sessionVersion = 0;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    userId = payload.sub;
    sessionVersion = typeof payload.sv === "number" ? payload.sv : 0;
  } catch {
    return null;
  }
  if (!userId) return null;

  const [row] = await getSql()`
    select id, username, display_name, role, must_change_password, session_version
    from app_users where id = ${userId} and is_active and approval_status = 'approved'`;
  if (!row || row.session_version !== sessionVersion) return null;

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
    sessionVersion: row.session_version,
  };
});

export function homeFor(user: SessionUser) {
  if (user.mustChangePassword) return "/change-password";
  return user.role === "admin" ? "/admin" : "/officer";
}

/** Page guard: sends anyone without the given role to the right place. */
export async function requirePageRole<R extends SessionUser["role"]>(role: R) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword || user.role !== role) redirect(homeFor(user));
  return user;
}
