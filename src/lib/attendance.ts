import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { getSql, isUniqueViolation, withTransaction } from "./db";
import { normalizeCenter, normalizeMemberId, normalizeMobile, normalizeName, type AttendanceStatus } from "./shared";

type Sql = ReturnType<typeof getSql>;

export async function writeAudit(
  sql: Sql,
  user: Pick<SessionUser, "id" | "username">,
  action: string,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
) {
  await sql`
    insert into audit_log (user_id, username, action, entity_id, details)
    values (${user.id}, ${user.username}, ${action}, ${entityId === null ? null : String(entityId)}, ${sql.json(details as never)})`;
}

/**
 * Must run inside the transaction that writes attendance. The shared row lock makes
 * "End Event" wait for in-flight marks, and any mark arriving after it is rejected.
 */
async function requireActiveEvent(tx: Sql, eventDay: number) {
  const [event] = await tx`select name, status from event_sessions where event_day = ${eventDay} for share`;
  if (!event || event.status !== "active") {
    throw new ApiError(409, "event_not_active", `${event?.name ?? "This event"} is not active. Attendance cannot be marked.`);
  }
}

export const eventDaySchema = z.coerce.number().int().min(1).max(3);

/** Splits a search box value into safe LIKE patterns. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function searchMembers(query: string, eventDay: number) {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!q) return [];

  const sql = getSql();
  const idPrefix = `${escapeLike(q.toUpperCase())}%`;
  const digits = q.replace(/[\s+-]/g, "");
  const mobilePattern = /^\d+$/.test(digits) ? `%${digits}%` : null;
  const mobilePrefix = mobilePattern ? `${digits}%` : null;
  const tokens = q.toLowerCase().split(" ").filter(Boolean).slice(0, 5).map((t) => `%${escapeLike(t)}%`);
  const nameStart = `${escapeLike(q.toLowerCase())}%`;

  // "ram pat" matches "Ramesh Patel": every typed piece has to appear in the name.
  const nameMatch = tokens.reduce((acc, token) => sql`${acc} and m.name ilike ${token}`, sql`true`);

  const rows = await sql`
    select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center,
           a.status as attendance_status, a.marked_at, u.display_name as marked_by
    from members m
    left join attendance a
      on a.member_id = m.id and a.event_day = ${eventDay} and a.status in ('present', 'absent')
    left join app_users u on u.id = a.marked_by
    where m.global_member_id like ${idPrefix}
      or (${nameMatch})
      ${mobilePattern ? sql`or m.mobile like ${mobilePattern}` : sql``}
    order by
      case
        when m.global_member_id = ${q.toUpperCase()} then 0
        when m.global_member_id like ${idPrefix} then 1
        when ${mobilePrefix}::text is not null and m.mobile like ${mobilePrefix}::text then 2
        when m.name ilike ${nameStart} then 3
        else 4
      end,
      length(m.global_member_id) nulls last,
      m.global_member_id nulls last,
      m.name
    limit 30`;
  return rows;
}

/**
 * What an officer may do is decided here, in one statement, so two officers tapping at once can't
 * get around it. Nothing yet, or removed by Admin: either status. Absent: can become Present, for
 * someone who arrives late. Present: stays as it is, because only Admin can undo attendance.
 */
export async function markAttendance(officer: SessionUser, memberId: number, eventDay: number, status: AttendanceStatus) {
  return withTransaction(async (tx) => {
    await requireActiveEvent(tx, eventDay);

    const [member] = await tx`select id, name from members where id = ${memberId}`;
    if (!member) throw new ApiError(404, "member_not_found", "Member not found.");

    const [before] = await tx`select status from attendance where member_id = ${member.id} and event_day = ${eventDay}`;

    const [saved] = await tx`
      insert into attendance (member_id, event_day, marked_by, status)
      values (${member.id}, ${eventDay}, ${officer.id}, ${status})
      on conflict (member_id, event_day) do update
        set status = excluded.status, marked_at = now(), marked_by = excluded.marked_by,
            cancelled_at = null, cancelled_by = null, cancel_reason = null
        where attendance.status = 'cancelled'
           or (attendance.status = 'absent' and excluded.status = 'present')
      returning id, marked_at`;

    if (!saved) {
      const [existing] = await tx`
        select a.status, a.marked_at, u.display_name as marked_by
        from attendance a join app_users u on u.id = a.marked_by
        where a.member_id = ${member.id} and a.event_day = ${eventDay}`;
      return {
        status: existing.status === "present" ? ("already_present" as const) : ("already_absent" as const),
        memberName: member.name as string,
        markedAt: existing.marked_at as Date,
        markedBy: existing.marked_by as string,
      };
    }

    await writeAudit(tx, officer, "attendance.mark", saved.id, {
      member_id: member.id,
      member_name: member.name,
      event_day: eventDay,
      status,
      previous_status: before?.status ?? null,
    });

    return {
      status: "marked" as const,
      attendance: status,
      memberName: member.name as string,
      markedAt: saved.marked_at as Date,
      markedBy: officer.displayName,
    };
  });
}

/** Names only: section 7.4 asks for the existing member's name, and nothing more is needed. */
export async function findMobileMatches(sql: Sql, mobile: string) {
  const rows = await sql`select name from members where mobile = ${mobile} order by name limit 5`;
  return rows.map((r) => r.name as string);
}

export const quickEntrySchema = z.object({
  eventDay: eventDaySchema,
  globalMemberId: z.string().max(50, "Member ID is too long.").optional().default(""),
  name: z.string().max(120, "Name is too long.").transform(normalizeName).pipe(z.string().min(1, "Name is required.")),
  mobile: z.string().transform((v, ctx) => {
    const mobile = normalizeMobile(v);
    if (!mobile) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
      return z.NEVER;
    }
    return mobile;
  }),
  gender: z.enum(["Male", "Female"], "Please choose a gender."),
  center: z.string().max(80, "Center name is too long.").transform(normalizeCenter).pipe(z.string().min(1, "Center is required.")),
  confirmDuplicateMobile: z.boolean().optional().default(false),
});

export async function quickEntry(officer: SessionUser, input: z.output<typeof quickEntrySchema>) {
  const globalId = normalizeMemberId(input.globalMemberId) || null;

  try {
    return await withTransaction(async (tx) => {
      await requireActiveEvent(tx, input.eventDay);

      if (globalId) {
        const [taken] = await tx`select name from members where global_member_id = ${globalId}`;
        if (taken) {
          throw new ApiError(409, "member_id_taken", `Member ID ${globalId} already belongs to ${taken.name}. Search for this member instead.`);
        }
      }

      if (!input.confirmDuplicateMobile) {
        const matches = await findMobileMatches(tx, input.mobile);
        if (matches.length > 0) {
          throw new ApiError(409, "duplicate_mobile", "Aa mobile number aa member sathe already registered chhe.", { matches });
        }
      }

      // Always a brand-new row: an existing member with the same number is never touched.
      const [member] = await tx`
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by, created_event_day)
        values (${globalId}, ${input.name}, ${input.mobile}, ${input.gender}, ${input.center},
                'quick_entry', ${officer.id}, ${input.eventDay})
        returning id, name`;

      const [attendance] = await tx`
        insert into attendance (member_id, event_day, marked_by)
        values (${member.id}, ${input.eventDay}, ${officer.id})
        returning id, marked_at`;

      await writeAudit(tx, officer, "member.quick_entry", member.id, {
        name: member.name,
        mobile: input.mobile,
        gender: input.gender,
        center: input.center,
        global_member_id: globalId,
        event_day: input.eventDay,
        duplicate_mobile_confirmed: input.confirmDuplicateMobile,
        attendance_id: attendance.id,
      });

      return { memberName: member.name as string, markedAt: attendance.marked_at as Date };
    });
  } catch (err) {
    if (isUniqueViolation(err, "members_global_member_id_key")) {
      throw new ApiError(409, "member_id_taken", `Member ID ${globalId} is already in use.`);
    }
    throw err;
  }
}

const HISTORY_PAGE_SIZE = 50;

/** Who was marked on a day, newest first. Attendance Admin has removed doesn't appear. */
export async function listHistory(officer: SessionUser, eventDay: number, scope: "mine" | "all", page: number) {
  const sql = getSql();
  const where = sql`a.event_day = ${eventDay} and a.status in ('present', 'absent') ${scope === "mine" ? sql`and a.marked_by = ${officer.id}` : sql``}`;
  const [records, [{ total }]] = await Promise.all([
    sql`
      select a.id, a.status, a.marked_at, u.display_name as marked_by, a.marked_by = ${officer.id} as is_mine,
             m.global_member_id, m.name, m.mobile, m.gender, m.center
      from attendance a
      join members m on m.id = a.member_id
      join app_users u on u.id = a.marked_by
      where ${where}
      order by a.marked_at desc, a.id desc
      limit ${HISTORY_PAGE_SIZE} offset ${(page - 1) * HISTORY_PAGE_SIZE}`,
    sql`select count(*)::int as total from attendance a where ${where}`,
  ]);
  return { records, total, pageSize: HISTORY_PAGE_SIZE };
}

const UNMARKED_PAGE_SIZE = 10;

/** Members with no Present or Absent yet on this day: the people still to be marked. */
export async function listUnmarked(eventDay: number, page: number) {
  const sql = getSql();
  const where = sql`not exists (
    select 1 from attendance a
    where a.member_id = m.id and a.event_day = ${eventDay} and a.status in ('present', 'absent'))`;
  const [members, [{ total }]] = await Promise.all([
    sql`
      select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center,
             null::text as attendance_status, null::timestamptz as marked_at, null::text as marked_by
      from members m where ${where}
      order by m.name, m.id
      limit ${UNMARKED_PAGE_SIZE} offset ${(page - 1) * UNMARKED_PAGE_SIZE}`,
    sql`select count(*)::int as total from members m where ${where}`,
  ]);
  return { members, total, pageSize: UNMARKED_PAGE_SIZE };
}

/** Each day's totals, and this person's own part of them. */
export async function listDayCounts(user: Pick<SessionUser, "id">) {
  const rows = await getSql()`
    select event_day,
           count(*) filter (where status = 'present')::int as present,
           count(*) filter (where status = 'absent')::int as absent,
           count(*) filter (where status = 'present' and marked_by = ${user.id})::int as my_present,
           count(*) filter (where status = 'absent' and marked_by = ${user.id})::int as my_absent
    from attendance group by event_day`;
  return Object.fromEntries(rows.map((c) => [c.event_day, { present: c.present, absent: c.absent, myPresent: c.my_present, myAbsent: c.my_absent }]));
}

/** Everything the marking screen shows first, so it arrives with the page, not after it. */
export async function getDeskData(user: SessionUser) {
  const events = await listEvents();
  const day = events.find((e) => e.status === "active")?.event_day ?? 1;
  const [counts, history, unmarked] = await Promise.all([listDayCounts(user), listHistory(user, day, "mine", 1), listUnmarked(day, 1)]);
  return JSON.parse(JSON.stringify({ events, counts, day, history, unmarked }));
}

export async function listEvents(sql: Sql = getSql()) {
  return sql`
    select event_day, name, status, started_at, ended_at
    from event_sessions order by event_day`;
}
