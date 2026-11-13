import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { getSql, isUniqueViolation, withTransaction } from "./db";
import { isMemberIdValid, MEMBER_ID_DIGITS, normalizeCenter, normalizeMemberId, normalizeMobile, normalizeName, type Gender } from "./shared";

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

export const eventDaySchema = z.coerce.number().int().min(1).max(32767);

export const eventNameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Please type a name for the session.").max(60, "Keep the session name to 60 characters or fewer."));

/** A person's whole name matches when each typed piece starts a word, in the same order. */
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * "jay kan" finds first name Jay..., last name Kan... (with or without a middle name), and
 * "jay pop kan" adds a middle name Pop.... The first piece must start the first name, so it doesn't
 * find "Monal Jaytibhai Kanani". One piece alone starts any word, to find someone by surname.
 */
export function nameSearchPattern(query: string) {
  const pieces = query.trim().split(/\s+/).filter(Boolean).slice(0, 5).map(escapeRegex);
  if (pieces.length === 0) return null;
  return pieces.length === 1 ? `(^|\\s)${pieces[0]}` : `^${pieces.join(".*\\s")}`;
}

/** Splits a search box value into safe LIKE patterns. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function cleanQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** A Member ID that starts with it, the name rule above, or part of a mobile number. `q` comes from `cleanQuery` and isn't empty. */
function memberMatches(sql: Sql, q: string) {
  const digits = q.replace(/[\s+-]/g, "");
  return sql`(
    m.global_member_id like ${`${escapeLike(q.toUpperCase())}%`}
    or m.name ~* ${nameSearchPattern(q)!}
    ${/^\d+$/.test(digits) ? sql`or m.mobile like ${`%${digits}%`}` : sql``}
  )`;
}

export async function searchMembers(user: SessionUser, query: string, eventDay: number, center: string | null = null) {
  const q = cleanQuery(query);
  if (!q) return [];

  const sql = getSql();
  const idPrefix = `${escapeLike(q.toUpperCase())}%`;
  const digits = q.replace(/[\s+-]/g, "");
  const mobilePrefix = /^\d+$/.test(digits) ? `${digits}%` : null;
  const firstName = `^${escapeRegex(q.split(" ")[0])}`;

  const rows = await sql`
    select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center,
           a.marked_at as present_at, u.display_name as marked_by
    from members m
    left join attendance a
      on a.member_id = m.id and a.event_day = ${eventDay} and a.status = 'present'
    left join app_users u on u.id = a.marked_by
    where ${user.genderScope ? sql`m.gender = ${user.genderScope}` : sql`true`}
      ${center ? sql`and m.center = ${center}` : sql``}
      and ${memberMatches(sql, q)}
    order by
      case
        when m.global_member_id = ${q.toUpperCase()} then 0
        when m.global_member_id like ${idPrefix} then 1
        when ${mobilePrefix}::text is not null and m.mobile like ${mobilePrefix}::text then 2
        when m.name ~* ${firstName} then 3
        else 4
      end,
      length(m.global_member_id) nulls last,
      m.global_member_id nulls last,
      m.name
    limit 30`;
  return rows;
}

/**
 * One statement decides each mark, so two devices tapping at once can't record it twice.
 * Present stays as it is: only Admin can remove attendance.
 */
export async function markAttendance(user: SessionUser, memberId: number, eventDay: number) {
  return withTransaction(async (tx) => {
    await requireActiveEvent(tx, eventDay);

    // Filtering by gender here means a member outside the officer's scope simply doesn't exist for them.
    const [member] = await tx`
      select id, name from members
      where id = ${memberId} ${user.genderScope ? tx`and gender = ${user.genderScope}` : tx``}`;
    if (!member) throw new ApiError(404, "member_not_found", "Member not found.");

    const [saved] = await tx`
      insert into attendance (member_id, event_day, marked_by, status)
      values (${member.id}, ${eventDay}, ${user.id}, 'present')
      on conflict (member_id, event_day) do update
        set status = 'present', marked_at = now(), marked_by = excluded.marked_by,
            cancelled_at = null, cancelled_by = null, cancel_reason = null
        where attendance.status <> 'present'
      returning id, marked_at`;

    if (!saved) {
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

    await writeAudit(tx, user, "attendance.mark", saved.id, {
      member_id: member.id,
      member_name: member.name,
      event_day: eventDay,
    });

    return {
      status: "marked" as const,
      memberName: member.name as string,
      markedAt: saved.marked_at as Date,
      markedBy: user.displayName,
    };
  });
}

/** Names only: section 7.4 asks for the existing member's name, and nothing more is needed. */
export async function findMobileMatches(sql: Sql, mobile: string) {
  const rows = await sql`select name from members where mobile = ${mobile} order by name limit 5`;
  return rows.map((r) => r.name as string);
}

/**
 * Same name and same mobile is the same person, so it can't be added again. Only the mobile matching
 * is usually family sharing a number, and only the name matching can be two different people, so
 * those ask the officer to check first. Details are only given for members this account can see.
 */
export async function findDuplicates(user: SessionUser, name: string, mobile: string | null, sql: Sql = getSql()) {
  const scope = user.genderScope ? sql`gender = ${user.genderScope}` : sql`true`;
  const [exact] = name && mobile
    ? await sql`select name, gender from members where mobile = ${mobile} and lower(name) = lower(${name}) limit 1`
    : [];
  const [mobileMatches, nameMatches] = await Promise.all([
    mobile ? findMobileMatches(sql, mobile) : [],
    name
      ? sql`
          select name, global_member_id, mobile, center from members
          where ${scope} and lower(name) = lower(${name}) order by global_member_id nulls last limit 5`
      : [],
  ]);
  return {
    exact: exact ? { name: !user.genderScope || exact.gender === user.genderScope ? (exact.name as string) : null } : null,
    mobileMatches,
    nameMatches: nameMatches.map((m) => ({ name: m.name as string, memberId: m.global_member_id as string | null, mobile: m.mobile as string | null, center: m.center as string })),
  };
}

/** Optional, but a new Member ID is exactly 6 digits. */
export const newMemberIdField = z
  .string()
  .optional()
  .default("")
  .transform((v) => v.trim())
  .refine((v) => v === "" || isMemberIdValid(v), `Member ID must be ${MEMBER_ID_DIGITS} digits.`);

export const memberNameField = z.string().max(120, "Name is too long.").transform(normalizeName).pipe(z.string().min(1, "Name is required."));
export const memberCenterField = z.string().max(80, "Center name is too long.").transform(normalizeCenter).pipe(z.string().min(1, "Center is required."));

/** Throws if another member already has this ID, naming them only if this account may see them. */
export async function refuseTakenMemberId(tx: Sql, user: SessionUser, globalId: string) {
  const [taken] = await tx`select name, gender from members where global_member_id = ${globalId}`;
  if (!taken) return;
  throw new ApiError(
    409,
    "member_id_taken",
    !user.genderScope || taken.gender === user.genderScope
      ? `Member ID ${globalId} already belongs to ${taken.name}. Search for this member instead.`
      : `Member ID ${globalId} is already in use.`,
  );
}

/** The same person can't be added twice. A shared mobile or name has to be confirmed first. */
export async function refuseDuplicates(tx: Sql, user: SessionUser, name: string, mobile: string | null, confirmed: boolean) {
  const found = await findDuplicates(user, name, mobile, tx);
  if (found.exact) {
    throw new ApiError(409, "member_exists", found.exact.name ? `${found.exact.name} already exists with this mobile number. Search for this member instead.` : "A member with this name and mobile number already exists.");
  }
  if (confirmed) return;
  if (found.mobileMatches.length > 0) {
    throw new ApiError(409, "duplicate_mobile", "Aa mobile number aa member sathe already registered chhe.", { matches: found.mobileMatches });
  }
  if (found.nameMatches.length > 0) {
    throw new ApiError(409, "duplicate_name", "A member with this name is already registered.", { nameMatches: found.nameMatches });
  }
}

export const quickEntrySchema = z.object({
  eventDay: eventDaySchema,
  globalMemberId: newMemberIdField,
  name: memberNameField,
  mobile: z.string().transform((v, ctx) => {
    const mobile = normalizeMobile(v);
    if (!mobile) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
      return z.NEVER;
    }
    return mobile;
  }),
  // Officers can't set this: their account decides it. Only Admin chooses.
  gender: z.enum(["Male", "Female"], "Please choose a gender.").optional(),
  center: memberCenterField,
  confirmDuplicateMobile: z.boolean().optional().default(false),
});

export async function quickEntry(user: SessionUser, input: z.output<typeof quickEntrySchema>) {
  const globalId = normalizeMemberId(input.globalMemberId) || null;
  const gender = user.genderScope ?? input.gender;
  if (!gender) throw new ApiError(400, "invalid_input", "Please choose a gender.");

  try {
    return await withTransaction(async (tx) => {
      await requireActiveEvent(tx, input.eventDay);

      if (globalId) await refuseTakenMemberId(tx, user, globalId);
      await refuseDuplicates(tx, user, input.name, input.mobile, input.confirmDuplicateMobile);

      // Always a brand-new row: an existing member with the same number is never touched.
      const [member] = await tx`
        insert into members (global_member_id, name, mobile, gender, center, created_source, created_by, created_event_day)
        values (${globalId}, ${input.name}, ${input.mobile}, ${gender}, ${input.center},
                'quick_entry', ${user.id}, ${input.eventDay})
        returning id, name`;

      const [attendance] = await tx`
        insert into attendance (member_id, event_day, marked_by)
        values (${member.id}, ${input.eventDay}, ${user.id})
        returning id, marked_at`;

      await writeAudit(tx, user, "member.quick_entry", member.id, {
        name: member.name,
        mobile: input.mobile,
        gender,
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

/**
 * Who was marked on a day, newest first. Officers see their own gender; Admin can see everyone.
 * A search narrows it the same way the marking search finds people. Only Admin picks a gender.
 */
export async function listHistory(
  user: SessionUser,
  eventDay: number,
  scope: "mine" | "all",
  page: number,
  { query = "", gender = null }: { query?: string; gender?: Gender | null } = {},
) {
  const sql = getSql();
  const q = cleanQuery(query);
  const onlyGender = user.genderScope ?? gender;
  const where = sql`a.event_day = ${eventDay} and a.status = 'present'
    ${onlyGender ? sql`and m.gender = ${onlyGender}` : sql``}
    ${!user.genderScope && scope === "mine" ? sql`and a.marked_by = ${user.id}` : sql``}
    ${q ? sql`and ${memberMatches(sql, q)}` : sql``}`;
  const [records, [{ total }]] = await Promise.all([
    sql`
      select a.id, a.marked_at, u.display_name as marked_by, a.marked_by = ${user.id} as is_mine,
             m.global_member_id, m.name, m.mobile, m.gender, m.center
      from attendance a
      join members m on m.id = a.member_id
      join app_users u on u.id = a.marked_by
      where ${where}
      order by a.marked_at desc, a.id desc
      limit ${HISTORY_PAGE_SIZE} offset ${(page - 1) * HISTORY_PAGE_SIZE}`,
    sql`select count(*)::int as total from attendance a join members m on m.id = a.member_id where ${where}`,
  ]);
  return { records, total, pageSize: HISTORY_PAGE_SIZE };
}

const UNMARKED_PAGE_SIZE = 10;

/** The value of an Area filter: nothing chosen means every area. */
export const centerFilter = (value: string | null) => (value && value !== "all" ? value.slice(0, 80) : null);

/** Members not yet marked Present on this day: the people still to be marked. */
export async function listUnmarked(user: SessionUser, eventDay: number, page: number, center: string | null = null) {
  const sql = getSql();
  const scope = user.genderScope ? sql`m.gender = ${user.genderScope}` : sql`true`;
  const where = sql`${scope} ${center ? sql`and m.center = ${center}` : sql``} and not exists (
    select 1 from attendance a
    where a.member_id = m.id and a.event_day = ${eventDay} and a.status = 'present')`;
  const [members, [{ total }], centers] = await Promise.all([
    sql`
      select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center,
             null::timestamptz as present_at, null::text as marked_by
      from members m where ${where}
      order by m.name, m.id
      limit ${UNMARKED_PAGE_SIZE} offset ${(page - 1) * UNMARKED_PAGE_SIZE}`,
    sql`select count(*)::int as total from members m where ${where}`,
    // Only areas this account has members in. An area appears here as soon as an upload adds it.
    sql`select distinct m.center from members m where ${scope} order by m.center`,
  ]);
  return { members, total, pageSize: UNMARKED_PAGE_SIZE, centers: centers.map((c) => c.center as string) };
}

/** Each day's total, and this account's own part of it. */
export async function listDayCounts(user: Pick<SessionUser, "id">) {
  const rows = await getSql()`
    select event_day,
           count(*) filter (where status = 'present')::int as present,
           count(*) filter (where status = 'present' and marked_by = ${user.id})::int as my_present
    from attendance group by event_day`;
  return Object.fromEntries(rows.map((c) => [c.event_day, { present: c.present, myPresent: c.my_present }]));
}

/** Everything the marking screen shows first, so it arrives with the page, not after it. */
export async function getDeskData(user: SessionUser) {
  const events = await listEvents();
  const day = events.find((e) => e.status === "active")?.event_day ?? events[0]?.event_day ?? 1;
  const [counts, history, unmarked] = await Promise.all([listDayCounts(user), listHistory(user, day, "all", 1), listUnmarked(user, day, 1)]);
  return JSON.parse(JSON.stringify({ events, counts, day, history, unmarked }));
}

export async function listEvents(sql: Sql = getSql()) {
  return sql`
    select event_day, name, status, started_at, ended_at
    from event_sessions order by event_day`;
}
