import "server-only";
import bcrypt from "bcryptjs";
import { ApiError } from "./api";
import { getSql } from "./db";

/**
 * Asks again for the password of the account that's logged in, before something that can't be
 * undone, so a phone left logged in can't wipe data by itself.
 */
export async function confirmOwnPassword(userId: string, password: unknown) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ApiError(400, "password_required", "Please enter your Admin password.");
  }
  const [row] = await getSql()`select password_hash from app_users where id = ${userId}`;
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new ApiError(403, "wrong_password", "That password isn't right. Use the password you log in with.");
  }
}
