import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, publicRoute, readJson } from "@/lib/api";
import { homeFor, startSession, verifyLogin } from "@/lib/auth";
import { writeAudit } from "@/lib/attendance";
import { getSql } from "@/lib/db";

const schema = z.object({
  username: z.string().min(1, "Enter your username.").max(100),
  password: z.string().min(1, "Enter your password.").max(200),
});

export const POST = publicRoute(async (req) => {
  const { username, password } = schema.parse(await readJson(req));
  const result = await verifyLogin(username, password);

  if (!result.ok) {
    throw result.reason === "locked"
      ? new ApiError(429, "locked", "Too many wrong attempts. Please wait 2 minutes and try again.")
      : new ApiError(401, "invalid_login", "Wrong username or password.");
  }

  await startSession(result.user);
  await writeAudit(getSql(), result.user, "auth.login", null);
  return NextResponse.json({ redirectTo: homeFor(result.user) });
});
