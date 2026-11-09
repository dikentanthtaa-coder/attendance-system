import { adminRoute } from "@/lib/api";
import { listOfficers } from "@/lib/officers";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  return listOfficers(params.get("q") ?? "", params.get("status") ?? "all", Math.max(1, Number(params.get("page")) || 1));
});
