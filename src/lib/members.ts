import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { memberCenterField, memberNameField, nameSearchPattern, newMemberIdField, refuseDuplicates, refuseTakenMemberId, writeAudit } from "./attendance";
import { getSql, isUniqueViolation, withTransaction } from "./db";
import { normalizeMemberId, normalizeMobile } from "./shared";

const PAGE_SIZE = 50;

export async function listMembers(query: string, page: number) {
  const q = query.trim().replace(/[\\%_]/g, "\\$&");
  const sql = getSql();

  const pattern = nameSearchPattern(query);
  const where = pattern
    ? sql`(m.global_member_id ilike ${`${q}%`} or m.mobile like ${`%${q}%`} or m.name ~* ${pattern})`
    : sql`true`;

  const [members, [{ total }]] = await Promise.all([
    sql`
      select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center, m.created_source,
             (select count(*)::int from attendance a where a.member_id = m.id and a.status = 'present') as attendance_count
      from members m where ${where}
      order by m.name, m.id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    sql`select count(*)::int as total from members m where ${where}`,
  ]);
  return { members, total, page, pageSize: PAGE_SIZE };
}

export const addMemberSchema = z.object({
  globalMemberId: newMemberIdField,
  name: memberNameField,
  // Optional, as in the registration list, but a number given must be a real 10-digit one.
  mobile: z
    .string()
    .optional()
    .default("")
    .transform((v, ctx) => {
      if (!v.trim()) return null;
      const mobile = normalizeMobile(v);
      if (!mobile) {
        ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
        return z.NEVER;
      }
      return mobile;
    }),
  gender: z.enum(["Male", "Female"], "Please choose a gender."),
  center: memberCenterField,
  confirmDuplicate: z.boolean().optional().default(false),
});

/**
 * Admin adding one registered person by hand, after the Excel list is in. Checked the same way as
 * Quick Entry, saved as a registered member (shown as Register), and not marked present.
 */
export async function addMember(admin: SessionUser, input: z.output<typeof addMemberSchema>) {
  const globalId = normalizeMemberId(input.globalMemberId) || null;
  try {
    return await withTransaction(async (tx) => {
      if (globalId) await refuseTakenMemberId(tx, admin, globalId);
      await refuseDuplicates(tx, admin, input.name, input.mobile, input.confirmDuplicate);
      const [member] = await tx`
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by)
        values (${globalId}, ${input.name}, ${input.mobile}, ${input.gender}, ${input.center}, 'excel_import', ${admin.id})
        returning id, name`;
      await writeAudit(tx, admin, "member.add", member.id, {
        name: member.name,
        mobile: input.mobile,
        gender: input.gender,
        center: input.center,
        global_member_id: globalId,
        duplicate_confirmed: input.confirmDuplicate,
      });
      return { memberName: member.name as string };
    });
  } catch (err) {
    if (isUniqueViolation(err, "members_global_member_id_key")) {
      throw new ApiError(409, "member_id_taken", `Member ID ${globalId} is already in use.`);
    }
    throw err;
  }
}
