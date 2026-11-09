import { listEvents } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import type { EventSession } from "@/lib/shared";
import { OfficerApp } from "./officer-app";

export default async function OfficerPage() {
  const officer = await requirePageRole("officer");
  // Round-trip through JSON so dates arrive as strings, same as the polling endpoint returns them.
  const events: EventSession[] = JSON.parse(JSON.stringify(await listEvents()));
  return <OfficerApp displayName={officer.displayName} initialEvents={events} />;
}
