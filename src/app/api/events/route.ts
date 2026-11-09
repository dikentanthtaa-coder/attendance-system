import { anyUserRoute } from "@/lib/api";
import { listDayCounts, listEvents } from "@/lib/attendance";
import { getSql } from "@/lib/db";

// Polled by every signed-in screen so status changes appear without a reload.
export const GET = anyUserRoute(async (user) => {
  const sql = getSql();
  const [events, counts] = await Promise.all([listEvents(sql), listDayCounts(user)]);
  return { events, counts };
});
