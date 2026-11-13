import { z } from "zod";
import { anyUserRoute } from "@/lib/api";
import { eventDaySchema, listHistory } from "@/lib/attendance";

export const GET = anyUserRoute(async (user, req) => {
  const params = new URL(req.url).searchParams;
  const eventDay = eventDaySchema.parse(params.get("day"));
  const scope = z.enum(["mine", "all"]).catch("mine").parse(params.get("scope"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const gender = z.enum(["Male", "Female"]).nullable().catch(null).parse(params.get("gender"));
  return listHistory(user, eventDay, scope, page, { query: params.get("q") ?? "", gender });
});
