import "server-only";
import ExcelJS from "exceljs";
import { z } from "zod";
import { nameSearchPattern } from "./attendance";
import { getSql } from "./db";
import { dayCell, SOURCE_LABEL, type EventStatus, type MemberSource } from "./shared";

export const DAY_REPORT_PAGE_SIZE = 50;

const filterSchema = z.object({
  q: z.string().max(80).catch(""),
  gender: z.enum(["all", "Male", "Female"]).catch("all"),
  center: z.string().max(80).catch("all"),
  // "all", or a day and status together: "P:1" is present on Day 1, "A:2" is absent on Day 2.
  show: z.string().regex(/^(all|[PA]:[1-9]\d{0,4})$/).catch("all"),
});

export type DayReportFilters = z.output<typeof filterSchema>;

export function parseDayReportFilters(params: URLSearchParams): DayReportFilters {
  return filterSchema.parse({
    q: params.get("q") ?? "",
    gender: params.get("gender") || "all",
    center: params.get("center") || "all",
    show: params.get("show") || "all",
  });
}

type Sql = ReturnType<typeof getSql>;

const memberWhere = (sql: Sql, f: DayReportFilters) => {
  const pattern = nameSearchPattern(f.q);
  let where = sql`true`;
  if (f.gender !== "all") where = sql`${where} and m.gender = ${f.gender}`;
  if (f.center !== "all") where = sql`${where} and m.center = ${f.center}`;
  if (pattern) {
    const text = f.q.trim().replace(/[\\%_]/g, "\\$&");
    where = sql`${where} and (m.global_member_id ilike ${`${text}%`} or m.mobile like ${`%${text}%`} or m.name ~* ${pattern})`;
  }
  return where;
};

/** Which members to list. "Absent on Day N" means not marked present that day. */
const showWhere = (sql: Sql, f: DayReportFilters) => {
  if (f.show === "all") return sql`true`;
  const day = Number(f.show.slice(2));
  const marked = sql`exists (select 1 from attendance a where a.member_id = m.id and a.event_day = ${day} and a.status = 'present')`;
  return f.show[0] === "P" ? marked : sql`not ${marked}`;
};

/**
 * A day gets a column once it has started, so the report grows from Day 1, to Days 1 and 2, to every
 * session. A is never stored: it's worked out from there being no mark once the day has ended.
 */
async function reportDays(sql: Sql) {
  const days = await sql`select event_day, name, status from event_sessions where status <> 'not_started' order by coalesce(day_no, event_day), event_day`;
  return days.map((d) => ({ day: d.event_day as number, name: d.name as string, status: d.status as EventStatus }));
}

const rowsQuery = (sql: Sql, f: DayReportFilters) => sql`
  select m.id, m.global_member_id, m.name, m.mobile, m.gender, m.center, m.created_source,
         coalesce(array_agg(a.event_day order by a.event_day) filter (where a.status = 'present'), '{}') as present_days
  from members m
  left join attendance a on a.member_id = m.id
  where ${memberWhere(sql, f)} and ${showWhere(sql, f)}
  group by m.id
  order by m.name, m.id`;

export async function getDayReport(f: DayReportFilters, page: number) {
  const sql = getSql();
  const [days, rows, [{ total }], [{ everyone }], present, centers] = await Promise.all([
    reportDays(sql),
    sql`${rowsQuery(sql, f)} limit ${DAY_REPORT_PAGE_SIZE} offset ${(page - 1) * DAY_REPORT_PAGE_SIZE}`,
    sql`select count(*)::int as total from members m where ${memberWhere(sql, f)} and ${showWhere(sql, f)}`,
    sql`select count(*)::int as everyone from members m where ${memberWhere(sql, f)}`,
    sql`
      select a.event_day, count(*)::int as total, count(*) filter (where m.created_source = 'quick_entry')::int as quick
      from attendance a join members m on m.id = a.member_id
      where a.status = 'present' and ${memberWhere(sql, f)}
      group by a.event_day`,
    sql`select distinct center from members order by center`,
  ]);
  const presentOn = new Map(present.map((r) => [r.event_day as number, { total: r.total as number, quick: r.quick as number }]));
  return {
    days: days.map((d) => {
      const { total: totalPresent, quick } = presentOn.get(d.day) ?? { total: 0, quick: 0 };
      return {
        ...d,
        // Present is people from the Excel list. Present + quick = totalPresent, and totalPresent + absent = everyone.
        present: totalPresent - quick,
        quick,
        totalPresent,
        absent: d.status === "ended" ? everyone - totalPresent : null,
        notMarked: d.status === "active" ? everyone - totalPresent : null,
      };
    }),
    rows: rows.map((r) => ({ ...r, cells: Object.fromEntries(days.map((d) => [d.day, dayCell(d.status, (r.present_days as number[]).includes(d.day))])) })),
    total,
    everyone,
    centers: centers.map((c) => c.center as string),
    page,
    pageSize: DAY_REPORT_PAGE_SIZE,
  };
}

const FILLS: Record<string, string> = { P: "FFE2F5E9", A: "FFFBE9E7", "-": "FFEDF1F5" };
const QUICK_FILL = "FFFDF1D6";

export async function buildDayReportExport(f: DayReportFilters) {
  const sql = getSql();
  const [days, rows, [{ sessions }]] = await Promise.all([
    reportDays(sql),
    rowsQuery(sql, f),
    sql`select count(*)::int as sessions from event_sessions`,
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("P-A Report", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Sr", width: 7 },
    { header: "Member ID", width: 14 },
    { header: "Name", width: 34 },
    { header: "Mobile", width: 14 },
    { header: "Gender", width: 9 },
    { header: "Center", width: 18 },
    { header: "Status", width: 15 },
    ...days.map((d) => ({ header: d.name, width: Math.max(8, Math.min(24, d.name.length + 2)) })),
    { header: "Days Present", width: 13 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  });

  const present = new Map(days.map((d) => [d.day, 0]));
  const quick = new Map(days.map((d) => [d.day, 0]));
  rows.forEach((r, i) => {
    const marked = r.present_days as number[];
    const cells = days.map((d) => dayCell(d.status, marked.includes(d.day)));
    const isQuick = r.created_source === "quick_entry";
    const row = sheet.addRow([i + 1, r.global_member_id ?? "", r.name, r.mobile ?? "", r.gender, r.center, SOURCE_LABEL[r.created_source as MemberSource], ...cells, marked.filter((d) => present.has(d)).length]);
    if (isQuick) {
      const status = row.getCell(7);
      status.font = { bold: true };
      status.fill = { type: "pattern", pattern: "solid", fgColor: { argb: QUICK_FILL } };
    }
    days.forEach((d, c) => {
      if (marked.includes(d.day)) {
        present.set(d.day, present.get(d.day)! + 1);
        if (isQuick) quick.set(d.day, quick.get(d.day)! + 1);
      }
      const cell = row.getCell(8 + c);
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILLS[cells[c]] } };
    });
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 + days.length } };

  const summary = workbook.addWorksheet("Totals");
  summary.columns = [{ width: 18 }, { width: 12 }, { width: 10 }, { width: 15 }, { width: 14 }, { width: 10 }];
  const top = summary.addRow(["Day", "Status", "Present", SOURCE_LABEL.quick_entry, "Total Present", "Absent"]);
  top.font = { bold: true };
  for (const d of days) {
    const total = present.get(d.day) ?? 0;
    const q = quick.get(d.day) ?? 0;
    summary.addRow([d.name, d.status === "ended" ? "Ended" : "Running", total - q, q, total, d.status === "ended" ? rows.length - total : "-"]);
  }
  summary.addRow([]);
  summary.addRow(["Members in report", rows.length]);
  summary.addRow([]);
  summary.addRow(["P = present. A = absent. - = day still running, not marked yet."]);
  summary.addRow([`Present + ${SOURCE_LABEL.quick_entry} = Total Present.`]);

  const part = days.length > 0 && days.length === sessions ? "all-days" : days.length === 0 ? "no-days" : `day-${days.map((d) => d.day).join("-")}`;
  return { buffer: await workbook.xlsx.writeBuffer(), fileName: `attendance_report_${part}.xlsx` };
}
