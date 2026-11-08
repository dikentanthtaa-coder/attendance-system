import { ApiError, officerRoute } from "@/lib/api";
import { findMobileMatches } from "@/lib/attendance";
import { getSql } from "@/lib/db";
import { normalizeMobile } from "@/lib/shared";

export const GET = officerRoute(async (_officer, req) => {
  const mobile = normalizeMobile(new URL(req.url).searchParams.get("mobile") ?? "");
  if (!mobile) throw new ApiError(400, "invalid_input", "Enter a valid 10-digit mobile number.");
  return { matches: await findMobileMatches(getSql(), mobile) };
});
