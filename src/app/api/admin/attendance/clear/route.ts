import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { eventDaySchema, writeAudit } from "@/lib/attendance";
import { withTransaction } from "@/lib/db";
import { confirmOwnPassword } from "@/lib/confirm-password";

const schema = z.object({
  password: z.string(),
  // "all", or one session's number.
  day: z.literal("all").or(eventDaySchema),
});

/** Admin deletes marked attendance, for every session or one, after typing their own password again. */
export const POST = adminRoute(async (admin, req) => {
  const { password, day } = schema.parse(await readJson(req));
  await confirmOwnPassword(admin.id, password);

  return withTransaction(async (tx) => {
    let name: string | null = null;
    if (day !== "all") {
      const [session] = await tx`select name from event_sessions where event_day = ${day}`;
      if (!session) throw new ApiError(404, "not_found", "This session no longer exists.");
      name = session.name;
    }
    const deleted = await tx`
      delete from attendance where ${day === "all" ? tx`true` : tx`event_day = ${day}`}
      returning status`;
    const present = deleted.filter((r) => r.status === "present").length;
    await writeAudit(tx, admin, "attendance.clear", day === "all" ? null : day, {
      session: name ?? "all",
      deleted: deleted.count,
      present,
    });
    return { cleared: present, session: name };
  });
});
