import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { eventDaySchema, eventNameSchema, listEvents, writeAudit } from "@/lib/attendance";
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

const renameSchema = z.object({ name: eventNameSchema });

/** Rename a session. Its attendance stays with it, because attendance points to the number, not the name. */
export const PATCH = adminRoute<RouteContext<"/api/admin/events/[day]">>(async (admin, req, ctx) => {
  const eventDay = eventDaySchema.parse((await ctx.params).day);
  const { name } = renameSchema.parse(await readJson(req));

  try {
    const events = await withTransaction(async (tx) => {
      const [before] = await tx`select name from event_sessions where event_day = ${eventDay} for update`;
      if (!before) throw new ApiError(404, "not_found", "This session no longer exists.");
      await tx`update event_sessions set name = ${name} where event_day = ${eventDay}`;
      await writeAudit(tx, admin, "event.rename", eventDay, { from: before.name, to: name });
      return listEvents(tx);
    });
    return { events };
  } catch (err) {
    if (isUniqueViolation(err, "event_sessions_name_key")) {
      throw new ApiError(409, "duplicate_name", `A session named "${name}" already exists. Please choose another name.`);
    }
    throw err;
  }
});

/** Remove a session added by mistake. Only one that has never started, so no attendance is lost. */
export const DELETE = adminRoute<RouteContext<"/api/admin/events/[day]">>(async (admin, _req, ctx) => {
  const eventDay = eventDaySchema.parse((await ctx.params).day);

  const events = await withTransaction(async (tx) => {
    await tx`lock table event_sessions in share row exclusive mode`;
    const [{ total }] = await tx`select count(*)::int as total from event_sessions`;
    if (total <= 1) throw new ApiError(409, "last_session", "This is the only session, so it can't be removed.");
    const deleted = await tx`
      delete from event_sessions
      where event_day = ${eventDay} and status = 'not_started'
        and not exists (select 1 from attendance where event_day = ${eventDay})
        and not exists (select 1 from members where created_event_day = ${eventDay})
      returning name`;
    if (deleted.count === 0) {
      throw new ApiError(409, "cannot_delete", "Only a session that has never started can be removed.");
    }
    await writeAudit(tx, admin, "event.delete", eventDay, { name: deleted[0].name });
    return listEvents(tx);
  });
  return { events };
});
