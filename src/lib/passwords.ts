import { randomBytes } from "node:crypto";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./shared";

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  // bcrypt ignores everything past 72 bytes, so a longer password would be weaker than it looks.
  .refine((v) => Buffer.byteLength(v) <= 72, "Password is too long.");

/** 15 readable characters in three groups, about 75 bits of entropy. No 0/O or 1/l to misread aloud. */
export function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = [...randomBytes(15)].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10)].map((g) => g.join("")).join("-");
}
