import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { eventDaySchema, listEvents, writeAudit } from "@/lib/attendance";
import { isUniqueViolation, withTransaction } from "@/lib/db";

const schema = z.object({ action: z.enum(["start", "end", "restart"]) });

export const POST = adminRoute<RouteContext<"/api/admin/events/[day]">>(async (admin, req, ctx) => {
  const eventDay = eventDaySchema.parse((await ctx.params).day);
  const { action } = schema.parse(await readJson(req));

  try {
    const events = await withTransaction(async (tx) => {
      // Each update only succeeds from the right state, so a double click or a stale screen is harmless.
      const updated =
        action === "start"
          ? await tx`
              update event_sessions set status = 'active', started_at = now(), started_by = ${admin.id}
              where event_day = ${eventDay} and status = 'not_started' returning name`
          : action === "restart"
            ? await tx`
                update event_sessions set status = 'active', ended_at = null, ended_by = null
                where event_day = ${eventDay} and status = 'ended' returning name`
            : await tx`
                update event_sessions set status = 'ended', ended_at = now(), ended_by = ${admin.id}
                where event_day = ${eventDay} and status = 'active' returning name`;

      if (updated.count === 0) {
        throw new ApiError(409, "invalid_transition", "This event's status has changed. Please check it and try again.");
      }
      await writeAudit(tx, admin, `event.${action}`, eventDay, { name: updated[0].name });
      return listEvents(tx);
    });
    return { events };
  } catch (err) {
    if (isUniqueViolation(err, "event_sessions_one_active")) {
      throw new ApiError(409, "another_event_active", "Another event day is already active. End it first, because only one can be active at a time.");
    }
    throw err;
  }
});
