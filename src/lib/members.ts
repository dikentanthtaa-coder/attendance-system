import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { memberCenterField, memberNameField, nameSearchPattern, newMemberIdField, refuseDuplicates, refuseTakenMemberId, writeAudit } from "./attendance";
import { getSql, isUniqueViolation, withTransaction } from "./db";
import { normalizeMemberId, normalizeMobile } from "./shared";

const PAGE_SIZE = 50;

const GENDERS = ["all", "Male", "Female"] as const;
const SOURCES = ["all", "excel_import", "quick_entry"] as const;
/** Days present: any, at least one, or none at all. */
const DAYS = ["all", "present", "never"] as const;

/**
 * The search and filters of the Members list. Deleting uses these too, so an unknown value is
 * refused there rather than quietly read as "all", which would delete more than was on screen.
 */
export const memberFiltersSchema = z.object({
  q: z.string().max(80).default(""),
  gender: z.enum(GENDERS).default("all"),
  center: z.string().max(80).default("all"),
  source: z.enum(SOURCES).default("all"),
  days: z.enum(DAYS).default("all"),
});

export type MemberFilters = z.output<typeof memberFiltersSchema>;

/** For listing, a bad value in the address just shows everyone for that filter. */
export function parseMemberFilters(params: URLSearchParams): MemberFilters {
  return z
    .object({
      q: memberFiltersSchema.shape.q.catch(""),
      gender: memberFiltersSchema.shape.gender.catch("all"),
      center: memberFiltersSchema.shape.center.catch("all"),
      source: memberFiltersSchema.shape.source.catch("all"),
      days: memberFiltersSchema.shape.days.catch("all"),
    })
    .parse({
      q: params.get("q") ?? "",
      gender: params.get("gender") || "all",
      center: params.get("center") || "all",
      source: params.get("source") || "all",
      days: params.get("days") || "all",
    });
}

/** True when the search or a filter narrows the list, so it isn't everyone. */
export const isFiltered = (f: MemberFilters) =>
  nameSearchPattern(f.q) !== null || f.gender !== "all" || f.center !== "all" || f.source !== "all" || f.days !== "all";

type Sql = ReturnType<typeof getSql>;

function memberWhere(sql: Sql, f: MemberFilters) {
  let where = sql`true`;
  const pattern = nameSearchPattern(f.q);
  if (pattern) {
    const q = f.q.trim().replace(/[\\%_]/g, "\\$&");
    where = sql`${where} and (m.global_member_id ilike ${`${q}%`} or m.mobile like ${`%${q}%`} or m.name ~* ${pattern})`;
  }
  if (f.gender !== "all") where = sql`${where} and m.gender = ${f.gender}`;
  if (f.center !== "all") where = sql`${where} and m.center = ${f.center}`;
  if (f.source !== "all") where = sql`${where} and m.created_source = ${f.source}`;
  if (f.days !== "all") {
    const present = sql`exists (select 1 from attendance a where a.member_id = m.id and a.status = 'present')`;
    where = sql`${where} and ${f.days === "present" ? present : sql`not ${present}`}`;
  }
  return where;
}

export async function listMembers(filters: MemberFilters, page: number) {
  const sql = getSql();
  const where = memberWhere(sql, filters);

  const [members, [{ total }], centers] = await Promise.all([
    sql`
      select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center, m.created_source,
             (select count(*)::int from attendance a where a.member_id = m.id and a.status = 'present') as attendance_count
      from members m where ${where}
      order by m.name, m.id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    sql`select count(*)::int as total from members m where ${where}`,
    sql`select distinct center from members order by center`,
  ]);
  return { members, total, page, pageSize: PAGE_SIZE, centers: centers.map((c) => c.center as string) };
}

/**
 * Deletes every member the search and filters match, with their attendance, as one change. Refused
 * with no filter at all, and when the number matching isn't the number Admin saw and agreed to.
 */
export async function deleteFilteredMembers(admin: SessionUser, filters: MemberFilters, expected: number) {
  if (!isFiltered(filters)) {
    throw new ApiError(400, "no_filter", "Choose a filter or search first. Delete Filtered never removes the whole list at once.");
  }
  return withTransaction(async (tx) => {
    const members = await tx`
      select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center, m.created_source
      from members m where ${memberWhere(tx, filters)}
      order by m.id
      for update`;
    if (members.length !== expected) {
      throw new ApiError(
        409,
        "list_changed",
        `The list changed while this was open: ${members.length} member${members.length === 1 ? "" : "s"} now match, not ${expected}. Check the list and try again.`,
        { total: members.length },
      );
    }
    if (members.length === 0) return { deleted: 0, removedAttendance: 0 };

    const ids = members.map((m) => m.id as number);
    const attendance = await tx`
      select member_id, event_day, marked_at, status from attendance where member_id = any(${ids}::int[])`;
    // Attendance goes with each member (on delete cascade).
    await tx`delete from members where id = any(${ids}::int[])`;

    // The audit entry keeps a full copy, as single deletes do, because nothing else is left.
    await writeAudit(tx, admin, "member.delete_filtered", null, {
      filters,
      deleted: members.length,
      members: [...members],
      attendance: [...attendance],
    });
    const removedAttendance = attendance.filter((a) => a.status === "present").length;
    return { deleted: members.length, removedAttendance };
  });
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
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by, added_by_hand)
        values (${globalId}, ${input.name}, ${input.mobile}, ${input.gender}, ${input.center}, 'excel_import', ${admin.id}, true)
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
