import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, publicRoute, readJson } from "@/lib/api";
import { homeFor, startSession, verifyLogin } from "@/lib/auth";
import { writeAudit } from "@/lib/attendance";
import { getSql } from "@/lib/db";

const schema = z.object({
  username: z.string().min(1, "Enter your email or mobile number.").max(200),
  password: z.string().min(1, "Enter your password.").max(200),
});

export const POST = publicRoute(async (req) => {
  const { username, password } = schema.parse(await readJson(req));
  const result = await verifyLogin(username, password);

  if (!result.ok) {
    if (result.reason === "locked") throw new ApiError(429, "locked", "Too many wrong attempts. Please wait 2 minutes and try again.");
    if (result.reason === "pending") throw new ApiError(403, "pending_approval", "Your registration is waiting for Admin to approve it. Please try again after that.");
    if (result.reason === "rejected") throw new ApiError(403, "no_access", "Your account doesn't have access. Please contact Admin.");
    throw new ApiError(401, "invalid_login", "Wrong login details or password.");
  }

  await startSession(result.user);
  await writeAudit(getSql(), result.user, "auth.login", null);
  return NextResponse.json({ redirectTo: homeFor(result.user) });
});
