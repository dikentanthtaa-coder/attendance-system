import { listEvents } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import type { EventSession } from "@/lib/shared";
import { Dashboard } from "./dashboard";
import { EventControls } from "./event-controls";

export default async function AdminPage() {
  await requirePageRole("admin");
  const events: EventSession[] = JSON.parse(JSON.stringify(await listEvents()));
  return (
    <>
      <EventControls initialEvents={events} />
      <Dashboard />
    </>
  );
}
