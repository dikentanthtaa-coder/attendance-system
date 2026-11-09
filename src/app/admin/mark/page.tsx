import { getDeskData } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import { AttendanceDesk } from "@/app/officer/attendance-desk";

/** The same screen officers use. Marks made here are credited to Admin in reports. */
export default async function AdminMarkPage() {
  const admin = await requirePageRole("admin");
  return <AttendanceDesk initial={await getDeskData(admin)} />;
}
