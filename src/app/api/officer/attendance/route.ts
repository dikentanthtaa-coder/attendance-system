import { z } from "zod";
import { anyUserRoute, readJson } from "@/lib/api";
import { eventDaySchema, markAttendance } from "@/lib/attendance";

const schema = z.object({ memberId: z.number().int().positive(), eventDay: eventDaySchema });

export const POST = anyUserRoute(async (user, req) => {
  const { memberId, eventDay } = schema.parse(await readJson(req));
  return markAttendance(user, memberId, eventDay);
});
