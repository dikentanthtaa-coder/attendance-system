import "server-only";
import { z } from "zod";
import { getSql } from "./db";

const IST = "Asia/Kolkata";

const filterSchema = z.object({
  event: z.enum(["all", "1", "2", "3"]).catch("all"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("all")).catch("all"),
  gender: z.enum(["all", "Male", "Female"]).catch("all"),
  center: z.string().max(80).catch("all"),
  source: z.enum(["all", "excel_import", "quick_entry"]).catch("all"),
  officer: z.uuid().or(z.literal("all")).catch("all"),
});

export type ReportFilters = z.output<typeof filterSchema>;

/** Unknown or missing filter values fall back to "all". */
export function parseFilters(params: URLSearchParams): ReportFilters {
  const get = (key: string) => params.get(key) || "all";
  return filterSchema.parse({
    event: get("event"),
    date: get("date"),
    gender: get("gender"),
    center: get("center"),
    source: get("source"),
    officer: get("officer"),
  });
}

type Sql = ReturnType<typeof getSql>;

/** The one definition of "matches the filters". Dashboard, records and export all use it, so they can't disagree. */
function attendanceWhere(sql: Sql, f: ReportFilters) {
  // Attendance Admin has removed ('cancelled') never appears in a report.
  let where = sql`a.status = 'present'`;
  if (f.event !== "all") where = sql`${where} and a.event_day = ${Number(f.event)}`;
  if (f.date !== "all") where = sql`${where} and (a.marked_at at time zone ${IST})::date = ${f.date}::date`;
  if (f.gender !== "all") where = sql`${where} and m.gender = ${f.gender}`;
  if (f.center !== "all") where = sql`${where} and m.center = ${f.center}`;
  if (f.source !== "all") where = sql`${where} and m.created_source = ${f.source}`;
  if (f.officer !== "all") where = sql`${where} and a.marked_by = ${f.officer}`;
  return where;
}

export async function getSummary(f: ReportFilters) {
  const sql = getSql();
  const where = attendanceWhere(sql, f);

  // Everyone in the member list, whether present or not. Only the filters that describe a member apply:
  // a day, a date or an officer is about attendance, so it doesn't change how many members there are.
  let memberWhere = sql`true`;
  if (f.gender !== "all") memberWhere = sql`${memberWhere} and m.gender = ${f.gender}`;
  if (f.center !== "all") memberWhere = sql`${memberWhere} and m.center = ${f.center}`;
  if (f.source !== "all") memberWhere = sql`${memberWhere} and m.created_source = ${f.source}`;

  const [[totals], byDay, [members], byOfficer] = await Promise.all([
    sql`
      select
        count(*) filter (where m.gender = 'Male')::int as male,
        count(*) filter (where m.gender = 'Female')::int as female,
        count(*)::int as total,
        count(distinct a.member_id)::int as unique_members,
        count(*) filter (where m.created_source = 'excel_import')::int as from_excel,
        count(*) filter (where m.created_source = 'quick_entry')::int as from_quick_entry
      from attendance a join members m on m.id = a.member_id
      where ${where}`,
    sql`
      select
        a.event_day,
        e.name as event_name,
        ((a.marked_at at time zone ${IST})::date)::text as date,
        count(*) filter (where m.gender = 'Male')::int as male,
        count(*) filter (where m.gender = 'Female')::int as female,
        count(*)::int as total
      from attendance a
      join members m on m.id = a.member_id
      join event_sessions e on e.event_day = a.event_day
      where ${where}
      group by a.event_day, e.name, 3
      order by a.event_day, 3`,
    sql`
      select
        count(*)::int as total,
        count(*) filter (where m.gender = 'Male')::int as male,
        count(*) filter (where m.gender = 'Female')::int as female,
        count(*) filter (where m.created_source = 'quick_entry')::int as quick
      from members m
      where ${memberWhere}`,
    // Every approved officer is listed even with nothing marked yet, along with anyone whose
    // marks are in the report, such as an officer whose access was later removed.
    sql`
      select u.id, u.display_name as name,
             coalesce(t.present, 0)::int as present
      from app_users u
      left join (
        select a.marked_by, count(*) as present
        from attendance a join members m on m.id = a.member_id
        where ${where}
        group by a.marked_by
      ) t on t.marked_by = u.id
      where (t.marked_by is not null or (u.role = 'officer' and u.is_active))
        ${f.officer !== "all" ? sql`and u.id = ${f.officer}` : sql``}
      order by coalesce(t.present, 0) desc, u.display_name`,
  ]);

  return {
    male: totals.male as number,
    female: totals.female as number,
    total: totals.total as number,
    uniqueMembers: totals.unique_members as number,
    fromExcel: totals.from_excel as number,
    fromQuickEntry: totals.from_quick_entry as number,
    members: {
      total: members.total as number,
      male: members.male as number,
      female: members.female as number,
      quick: members.quick as number,
    },
    byOfficer: byOfficer.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      present: r.present as number,
    })),
    byDay: byDay.map((r) => ({
      eventDay: r.event_day as number,
      eventName: r.event_name as string,
      date: r.date as string,
      male: r.male as number,
      female: r.female as number,
      total: r.total as number,
    })),
  };
}

export async function getFilterOptions() {
  const sql = getSql();
  const [centers, dates, officers] = await Promise.all([
    sql`select distinct center from members order by center`,
    sql`
      select distinct ((marked_at at time zone ${IST})::date)::text as date
      from attendance where status = 'present' order by 1 desc`,
    sql`
      select u.id, u.display_name as name from app_users u
      where (u.role = 'officer' and u.is_active)
        or exists (select 1 from attendance a where a.marked_by = u.id and a.status = 'present')
      order by u.display_name`,
  ]);
  return {
    centers: centers.map((r) => r.center as string),
    dates: dates.map((r) => r.date as string),
    officers: officers.map((r) => ({ id: r.id as string, name: r.name as string })),
  };
}

export async function getReport(filters: ReportFilters) {
  const [summary, options] = await Promise.all([getSummary(filters), getFilterOptions()]);
  return { summary, options };
}
