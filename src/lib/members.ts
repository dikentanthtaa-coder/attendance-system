import "server-only";
import { nameSearchPattern } from "./attendance";
import { getSql } from "./db";

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
