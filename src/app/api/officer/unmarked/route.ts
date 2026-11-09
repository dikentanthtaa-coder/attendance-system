import { anyUserRoute } from "@/lib/api";
import { eventDaySchema, listUnmarked } from "@/lib/attendance";

export const GET = anyUserRoute(async (_user, req) => {
  const params = new URL(req.url).searchParams;
  return listUnmarked(eventDaySchema.parse(params.get("day")), Math.max(1, Number(params.get("page")) || 1));
});
