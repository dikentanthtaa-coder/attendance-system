import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { writeAudit } from "@/lib/attendance";
import { withTransaction } from "@/lib/db";

const schema = z.object({
  action: z.enum(["present", "absent", "remove"]),
  reason: z.string().trim().min(1, "Please enter a reason for the correction.").max(300),
});

/** The only way attendance can be undone or changed against the officers' rules, so Admin only. */
export const POST = adminRoute<RouteContext<"/api/admin/attendance/[id]/correct">>(async (admin, req, ctx) => {
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  const { action, reason } = schema.parse(await readJson(req));

  return withTransaction(async (tx) => {
    const [before] = await tx`
      select a.status, a.member_id, a.event_day, a.marked_at, a.marked_by, m.name
      from attendance a join members m on m.id = a.member_id
      where a.id = ${id} and a.status in ('present', 'absent')
      for update of a`;
    if (!before) throw new ApiError(404, "not_found", "This attendance record no longer exists.");

    const details = {
      reason,
      previous_status: before.status,
      member_id: before.member_id,
      member_name: before.name,
      event_day: before.event_day,
      originally_marked_at: before.marked_at,
      originally_marked_by: before.marked_by,
    };

    if (action === "remove") {
      await tx`
        update attendance set status = 'cancelled', cancelled_at = now(), cancelled_by = ${admin.id}, cancel_reason = ${reason}
        where id = ${id}`;
      await writeAudit(tx, admin, "attendance.cancel", id, details);
    } else {
      if (before.status === action) throw new ApiError(409, "no_change", `${before.name} is already marked ${action}.`);
      await tx`update attendance set status = ${action} where id = ${id}`;
      await writeAudit(tx, admin, "attendance.correct", id, { ...details, status: action });
    }
    return { ok: true };
  });
});
