import { z } from "zod";
import { adminRoute, readJson } from "@/lib/api";
import { reviewOfficer, reviewSchema } from "@/lib/officers";

export const PATCH = adminRoute<RouteContext<"/api/admin/officers/[id]">>(async (admin, req, ctx) => {
  const id = z.uuid("Officer not found.").parse((await ctx.params).id);
  const { action } = reviewSchema.parse(await readJson(req));
  return reviewOfficer(admin, id, action);
});
