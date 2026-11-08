import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import type { Officer, SessionUser } from "./auth";
import { getSql, isUniqueViolation, withTransaction } from "./db";
import { normalizeCenter, normalizeMemberId, normalizeMobile, normalizeName } from "./shared";

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

export async function searchMembers(officer: Officer, query: string, eventDay: number) {
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
    select m.id, m.global_member_id, m.name, m.mobile, m.center,
           a.marked_at as present_at, u.display_name as present_marked_by
    from members m
    left join attendance a
      on a.member_id = m.id and a.event_day = ${eventDay} and a.status = 'present'
    left join app_users u on u.id = a.marked_by
    where m.gender = ${officer.genderScope}
      and (
        m.global_member_id like ${idPrefix}
        or (${nameMatch})
        ${mobilePattern ? sql`or m.mobile like ${mobilePattern}` : sql``}
      )
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

export async function markAttendance(officer: Officer, memberId: number, eventDay: number) {
  return withTransaction(async (tx) => {
    await requireActiveEvent(tx, eventDay);

    // Filtering by gender here means a member outside the officer's scope simply doesn't exist for them.
    const [member] = await tx`
      select id, name, global_member_id from members
      where id = ${memberId} and gender = ${officer.genderScope}`;
    if (!member) throw new ApiError(404, "member_not_found", "Member not found.");

    const [inserted] = await tx`
      insert into attendance (member_id, event_day, marked_by)
      values (${member.id}, ${eventDay}, ${officer.id})
      on conflict (member_id, event_day) do update
        set status = 'present', marked_at = now(), marked_by = excluded.marked_by,
            cancelled_at = null, cancelled_by = null, cancel_reason = null
        where attendance.status = 'cancelled'
      returning id, marked_at`;

    if (!inserted) {
      const [existing] = await tx`
        select a.marked_at, u.display_name as marked_by
        from attendance a join app_users u on u.id = a.marked_by
        where a.member_id = ${member.id} and a.event_day = ${eventDay}`;
      return {
        status: "already_present" as const,
        memberName: member.name as string,
        markedAt: existing.marked_at as Date,
        markedBy: existing.marked_by as string,
      };
    }

    await writeAudit(tx, officer, "attendance.mark", inserted.id, {
      member_id: member.id,
      member_name: member.name,
      event_day: eventDay,
    });

    return {
      status: "marked" as const,
      memberName: member.name as string,
      markedAt: inserted.marked_at as Date,
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
  center: z.string().max(80, "Center name is too long.").transform(normalizeCenter).pipe(z.string().min(1, "Center is required.")),
  confirmDuplicateMobile: z.boolean().optional().default(false),
});

export async function quickEntry(officer: Officer, input: z.output<typeof quickEntrySchema>) {
  const globalId = normalizeMemberId(input.globalMemberId) || null;

  try {
    return await withTransaction(async (tx) => {
      await requireActiveEvent(tx, input.eventDay);

      if (globalId) {
        const [taken] = await tx`select name, gender from members where global_member_id = ${globalId}`;
        if (taken) {
          // Only name the holder if the officer is allowed to see that member.
          throw new ApiError(
            409,
            "member_id_taken",
            taken.gender === officer.genderScope
              ? `Member ID ${globalId} already belongs to ${taken.name}. Search for this member instead.`
              : `Member ID ${globalId} is already in use.`,
          );
        }
      }

      if (!input.confirmDuplicateMobile) {
        const matches = await findMobileMatches(tx, input.mobile);
        if (matches.length > 0) {
          throw new ApiError(409, "duplicate_mobile", "Aa mobile number aa member sathe already registered chhe.", { matches });
        }
      }

      // Always a brand-new row: an existing member with the same number is never touched.
      // Gender comes from the login, not from the request.
      const [member] = await tx`
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by, created_event_day)
        values (${globalId}, ${input.name}, ${input.mobile}, ${officer.genderScope}, ${input.center},
                'quick_entry', ${officer.id}, ${input.eventDay})
        returning id, name`;

      const [attendance] = await tx`
        insert into attendance (member_id, event_day, marked_by)
        values (${member.id}, ${input.eventDay}, ${officer.id})
        returning id, marked_at`;

      await writeAudit(tx, officer, "member.quick_entry", member.id, {
        name: member.name,
        mobile: input.mobile,
        gender: officer.genderScope,
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

export async function listEvents(sql: Sql = getSql()) {
  return sql`
    select event_day, name, status, started_at, ended_at
    from event_sessions order by event_day`;
}
