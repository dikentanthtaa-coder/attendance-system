import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { eventNameSchema, listEvents, writeAudit } from "@/lib/attendance";
import { isCheckViolation, isUniqueViolation, withTransaction } from "@/lib/db";

const schema = z.object({
  name: eventNameSchema,
  /** Adds the session to this day, after its other sessions. Without it, the session is a new day. */
  dayNo: z.number().int().min(1).max(32767).optional(),
});

/**
 * Admin adds a session: a new day after the others, or another session in an existing day, such as
 * an Evening session. It starts as Not Started, like the first three, and has its own attendance.
 */
export const POST = adminRoute(async (admin, req) => {
  const { name, dayNo } = schema.parse(await readJson(req));
  try {
    const events = await withTransaction(async (tx) => {
      // Two Admin tabs adding at once would otherwise pick the same next number.
      await tx`lock table event_sessions in share row exclusive mode`;
      if (dayNo !== undefined) {
        const [day] = await tx`select 1 from event_sessions where coalesce(day_no, event_day) = ${dayNo} limit 1`;
        if (!day) throw new ApiError(404, "day_not_found", "This day no longer exists. Please reload the page.");
      }
      const [created] = await tx`
        insert into event_sessions (event_day, day_no, name)
        select coalesce(max(event_day), 0) + 1,
               coalesce(${dayNo ?? null}::smallint, coalesce(max(coalesce(day_no, event_day)), 0) + 1),
               ${name}
        from event_sessions
        returning event_day, day_no`;
      await writeAudit(tx, admin, "event.create", created.event_day, { name, day_no: created.day_no });
      return listEvents(tx);
    });
    return { events };
  } catch (err) {
    if (isUniqueViolation(err, "event_sessions_name_key")) {
      throw new ApiError(409, "duplicate_name", `A session named "${name}" already exists. Please choose another name.`);
    }
    // The database still allows only Days 1 to 3 until db/migrations/006_custom_sessions.sql is applied.
    if (isCheckViolation(err, "event_sessions_event_day_check")) {
      throw new ApiError(
        503,
        "database_update_needed",
        "The database hasn't been updated to allow more than 3 sessions yet. Run \"npm run migrate\", then try again.",
      );
    }
    throw err;
  }
});
