import { adminRoute } from "@/lib/api";
import { listMembers } from "@/lib/members";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  return listMembers(params.get("q") ?? "", Math.max(1, Number(params.get("page")) || 1));
});
