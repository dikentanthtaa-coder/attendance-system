import { anyUserRoute } from "@/lib/api";
import { centerFilter, eventDaySchema, searchMembers } from "@/lib/attendance";

export const GET = anyUserRoute(async (user, req) => {
  const params = new URL(req.url).searchParams;
  const eventDay = eventDaySchema.parse(params.get("day"));
  return { results: await searchMembers(user, params.get("q") ?? "", eventDay, centerFilter(params.get("center"))) };
});
