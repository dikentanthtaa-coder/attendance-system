import { listEvents } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import { getReport, parseFilters } from "@/lib/reports";
import type { EventSession } from "@/lib/shared";
import { Dashboard } from "./dashboard";
import { EventControls } from "./event-controls";

export default async function AdminPage() {
  await requirePageRole("admin");
  // Loaded here so the numbers arrive with the page, instead of placeholders that fill in after.
  const [rawEvents, report] = await Promise.all([
    listEvents(),
    getReport(parseFilters(new URLSearchParams()), 1),
  ]);
  const events: EventSession[] = JSON.parse(JSON.stringify(rawEvents));
  return (
    <>
      <EventControls initialEvents={events} />
      <Dashboard initial={JSON.parse(JSON.stringify(report))} generatedAt={new Date().toISOString()} />
    </>
  );
}
