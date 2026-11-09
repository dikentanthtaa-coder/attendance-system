import { z } from "zod";
import { adminRoute } from "@/lib/api";
import { resetOfficerPassword } from "@/lib/officers";

export const POST = adminRoute<RouteContext<"/api/admin/officers/[id]/reset-password">>(async (admin, _req, ctx) => {
  const id = z.uuid("Officer not found.").parse((await ctx.params).id);
  return resetOfficerPassword(admin, id);
});
