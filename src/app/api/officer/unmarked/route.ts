import { anyUserRoute } from "@/lib/api";
import { centerFilter, eventDaySchema, listUnmarked } from "@/lib/attendance";

export const GET = anyUserRoute(async (user, req) => {
  const params = new URL(req.url).searchParams;
  return listUnmarked(user, eventDaySchema.parse(params.get("day")), Math.max(1, Number(params.get("page")) || 1), centerFilter(params.get("center")));
});
