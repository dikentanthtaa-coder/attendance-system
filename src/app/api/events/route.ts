import { anyUserRoute } from "@/lib/api";
import { listEvents } from "@/lib/attendance";
import { getSql } from "@/lib/db";

// Polled by every signed-in screen so status changes appear without a reload.
export const GET = anyUserRoute(async (user) => {
  const sql = getSql();
  const events = await listEvents(sql);
  if (user.role !== "officer") return { events };

  const counts = await sql`
    select event_day,
           count(*) filter (where status = 'present')::int as present,
           count(*) filter (where status = 'absent')::int as absent
    from attendance group by event_day`;
  return { events, counts: Object.fromEntries(counts.map((c) => [c.event_day, { present: c.present, absent: c.absent }])) };
});
