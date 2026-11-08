import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { writeAudit } from "@/lib/attendance";
import { withTransaction } from "@/lib/db";

const schema = z.object({
  reason: z.string().trim().min(1, "Please enter a reason for the correction.").max(300),
});

export const POST = adminRoute<RouteContext<"/api/admin/attendance/[id]/cancel">>(async (admin, req, ctx) => {
  const id = z.coerce.number().int().positive().parse((await ctx.params).id);
  const { reason } = schema.parse(await readJson(req));

  return withTransaction(async (tx) => {
    const [row] = await tx`
      update attendance a set status = 'cancelled', cancelled_at = now(), cancelled_by = ${admin.id}, cancel_reason = ${reason}
      from members m
      where a.id = ${id} and a.status = 'present' and m.id = a.member_id
      returning a.member_id, a.event_day, a.marked_at, a.marked_by, m.name`;
    if (!row) throw new ApiError(404, "not_found", "This attendance record no longer exists.");

    await writeAudit(tx, admin, "attendance.cancel", id, {
      reason,
      member_id: row.member_id,
      member_name: row.name,
      event_day: row.event_day,
      originally_marked_at: row.marked_at,
      originally_marked_by: row.marked_by,
    });
    return { ok: true };
  });
});
