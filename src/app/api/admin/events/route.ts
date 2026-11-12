import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { eventNameSchema, listEvents, writeAudit } from "@/lib/attendance";
import { isCheckViolation, isUniqueViolation, withTransaction } from "@/lib/db";

const schema = z.object({ name: eventNameSchema });

/** Admin adds a session after the existing ones. It starts as Not Started, like the first three. */
export const POST = adminRoute(async (admin, req) => {
  const { name } = schema.parse(await readJson(req));
  try {
    const events = await withTransaction(async (tx) => {
      // Two Admin tabs adding at once would otherwise pick the same next number.
      await tx`lock table event_sessions in share row exclusive mode`;
      const [created] = await tx`
        insert into event_sessions (event_day, name)
        select coalesce(max(event_day), 0) + 1, ${name} from event_sessions
        returning event_day`;
      await writeAudit(tx, admin, "event.create", created.event_day, { name });
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
