import { adminRoute } from "@/lib/api";
import { getSql } from "@/lib/db";

const PAGE_SIZE = 50;

export const GET = adminRoute(async (_admin, req) => {
  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = (params.get("q") ?? "").trim().replace(/[\\%_]/g, "\\$&");
  const sql = getSql();

  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const nameMatch = tokens.reduce((acc, t) => sql`${acc} and m.name ilike ${`%${t}%`}`, sql`true`);
  const where = q
    ? sql`(m.global_member_id ilike ${`${q}%`} or m.mobile like ${`%${q}%`} or (${nameMatch}))`
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
});
