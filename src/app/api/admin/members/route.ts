import { adminRoute, readJson } from "@/lib/api";
import { addMember, addMemberSchema, listMembers } from "@/lib/members";

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  return listMembers(params.get("q") ?? "", Math.max(1, Number(params.get("page")) || 1));
});

export const POST = adminRoute(async (admin, req) => {
  return addMember(admin, addMemberSchema.parse(await readJson(req)));
});
