import { anyUserRoute } from "@/lib/api";
import { findDuplicates } from "@/lib/attendance";
import { isMemberIdValid, normalizeMemberId, normalizeMobile, normalizeName } from "@/lib/shared";

/** Lets Quick Entry warn while typing. Saving repeats these checks, so they can't be skipped. */
export const GET = anyUserRoute(async (user, req) => {
  const params = new URL(req.url).searchParams;
  const name = normalizeName(params.get("name") ?? "").slice(0, 120);
  const mobile = normalizeMobile(params.get("mobile") ?? "");
  const memberId = normalizeMemberId(params.get("memberId") ?? "");
  return findDuplicates(user, name, mobile, undefined, isMemberIdValid(memberId) ? memberId : null);
});
