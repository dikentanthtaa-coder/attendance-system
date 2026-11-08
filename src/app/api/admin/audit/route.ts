import { adminRoute } from "@/lib/api";
import { getSql } from "@/lib/db";

const PAGE_SIZE = 50;

export const GET = adminRoute(async (_admin, req) => {
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page")) || 1);
  const sql = getSql();
  const entries = await sql`
    select id, at, username, action, entity_id, details
    from audit_log order by at desc, id desc
    limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}`;
  return { entries: entries.slice(0, PAGE_SIZE), hasMore: entries.length > PAGE_SIZE, page };
});
