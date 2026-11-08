import { anyUserRoute } from "@/lib/api";
import { listEvents } from "@/lib/attendance";
import { getSql } from "@/lib/db";

// Polled by every signed-in screen so status changes appear without a reload.
export const GET = anyUserRoute(async (user) => {
  const sql = getSql();
  const events = await listEvents(sql);
  if (user.role !== "officer") return { events };

  // An officer only ever gets the count for their own gender.
  const counts = await sql`
    select a.event_day, count(*)::int as count
    from attendance a join members m on m.id = a.member_id
    where a.status = 'present' and m.gender = ${user.genderScope}
    group by a.event_day`;
  return { events, counts: Object.fromEntries(counts.map((c) => [c.event_day, c.count])) };
});
