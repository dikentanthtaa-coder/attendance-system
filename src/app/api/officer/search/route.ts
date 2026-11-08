import { officerRoute } from "@/lib/api";
import { eventDaySchema, searchMembers } from "@/lib/attendance";

export const GET = officerRoute(async (officer, req) => {
  const params = new URL(req.url).searchParams;
  const eventDay = eventDaySchema.parse(params.get("day"));
  return { results: await searchMembers(officer, params.get("q") ?? "", eventDay) };
});
