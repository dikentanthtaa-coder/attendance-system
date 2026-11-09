import { anyUserRoute } from "@/lib/api";
import { eventDaySchema, searchMembers } from "@/lib/attendance";

export const GET = anyUserRoute(async (_user, req) => {
  const params = new URL(req.url).searchParams;
  const eventDay = eventDaySchema.parse(params.get("day"));
  return { results: await searchMembers(params.get("q") ?? "", eventDay) };
});
