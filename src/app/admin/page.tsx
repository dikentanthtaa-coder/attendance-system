import { ShieldCheck } from "lucide-react";
import { Alert, LinkButton } from "@/components/ui";
import { listEvents } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import { countPendingOfficers } from "@/lib/officers";
import type { EventSession } from "@/lib/shared";
import { Dashboard } from "./dashboard";
import { EventControls } from "./event-controls";

export default async function AdminPage() {
  await requirePageRole("admin");
  const [rawEvents, [{ pending }]] = await Promise.all([listEvents(), countPendingOfficers()]);
  const events: EventSession[] = JSON.parse(JSON.stringify(rawEvents));
  return (
    <>
      <EventControls initialEvents={events} />
      {pending > 0 && (
        <Alert
          tone="info"
          title={`${pending} new ${pending === 1 ? "officer is" : "officers are"} waiting for your approval.`}
          action={<LinkButton href="/admin/officers" variant="secondary" size="sm" icon={ShieldCheck}>Review</LinkButton>}
        />
      )}
      <Dashboard />
    </>
  );
}
