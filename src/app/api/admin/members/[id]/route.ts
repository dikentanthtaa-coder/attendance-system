import { z } from "zod";
import { adminRoute, ApiError, readJson } from "@/lib/api";
import { writeAudit } from "@/lib/attendance";
import { isUniqueViolation, withTransaction } from "@/lib/db";
import { normalizeCenter, normalizeMemberId, normalizeMobile, normalizeName } from "@/lib/shared";

type Ctx = RouteContext<"/api/admin/members/[id]">;

const idSchema = z.coerce.number().int().positive();

const editSchema = z.object({
  globalMemberId: z.string().max(50, "Member ID is too long.").transform(normalizeMemberId),
  name: z.string().max(120, "Name is too long.").transform(normalizeName).pipe(z.string().min(1, "Name is required.")),
  mobile: z.string().transform((v, ctx) => {
    if (!v.trim()) return null; // not everyone has a number on record
    const mobile = normalizeMobile(v);
    if (!mobile) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
      return z.NEVER;
    }
    return mobile;
  }),
  gender: z.enum(["Male", "Female"], { message: "Gender must be Male or Female." }),
  center: z.string().max(80, "Center name is too long.").transform(normalizeCenter).pipe(z.string().min(1, "Center is required.")),
});

export const PATCH = adminRoute<Ctx>(async (admin, req, ctx) => {
  const id = idSchema.parse((await ctx.params).id);
  const input = editSchema.parse(await readJson(req));

  try {
    return await withTransaction(async (tx) => {
      const [before] = await tx`
        select global_member_id, name, mobile, gender, center from members where id = ${id} for update`;
      if (!before) throw new ApiError(404, "not_found", "This member no longer exists.");

      await tx`
        update members set global_member_id = ${input.globalMemberId || null}, name = ${input.name},
          mobile = ${input.mobile}, gender = ${input.gender}, center = ${input.center}, updated_at = now()
        where id = ${id}`;
      await writeAudit(tx, admin, "member.edit", id, { before: { ...before }, after: input });
      return { ok: true };
    });
  } catch (err) {
    if (isUniqueViolation(err, "members_global_member_id_key")) {
      throw new ApiError(409, "member_id_taken", `Member ID ${input.globalMemberId} is already used by another member.`);
    }
    throw err;
  }
});

export const DELETE = adminRoute<Ctx>(async (admin, _req, ctx) => {
  const id = idSchema.parse((await ctx.params).id);

  return withTransaction(async (tx) => {
    const attendance = await tx`select event_day, marked_at, status from attendance where member_id = ${id}`;
    const [deleted] = await tx`
      delete from members where id = ${id}
      returning global_member_id, name, mobile, gender, center, created_source`;
    if (!deleted) throw new ApiError(404, "not_found", "This member no longer exists.");

    // The audit entry keeps a full copy, because the attendance rows are removed with the member.
    await writeAudit(tx, admin, "member.delete", id, { member: { ...deleted }, attendance: [...attendance] });
    return { ok: true };
  });
});
