import { z } from "zod";
import { officerRoute, readJson } from "@/lib/api";
import { eventDaySchema, markAttendance } from "@/lib/attendance";

const schema = z.object({
  memberId: z.number().int().positive(),
  eventDay: eventDaySchema,
  status: z.enum(["present", "absent"]).default("present"),
});

export const POST = officerRoute(async (officer, req) => {
  const { memberId, eventDay, status } = schema.parse(await readJson(req));
  return markAttendance(officer, memberId, eventDay, status);
});
