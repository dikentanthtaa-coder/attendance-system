import { officerRoute } from "@/lib/api";
import { eventDaySchema, searchMembers } from "@/lib/attendance";

export const GET = officerRoute(async (_officer, req) => {
  const params = new URL(req.url).searchParams;
  const eventDay = eventDaySchema.parse(params.get("day"));
  return { results: await searchMembers(params.get("q") ?? "", eventDay) };
});
