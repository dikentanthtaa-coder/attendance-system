import { z } from "zod";
import { anyUserRoute, readJson } from "@/lib/api";
import { eventDaySchema, markAttendance } from "@/lib/attendance";

const schema = z.object({
  memberId: z.number().int().positive(),
  eventDay: eventDaySchema,
  status: z.enum(["present", "absent"]).default("present"),
});

export const POST = anyUserRoute(async (user, req) => {
  const { memberId, eventDay, status } = schema.parse(await readJson(req));
  return markAttendance(user, memberId, eventDay, status);
});
