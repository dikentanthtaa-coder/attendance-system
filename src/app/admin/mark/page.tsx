import { getDeskData } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import { AttendanceDesk } from "@/app/officer/attendance-desk";

/** The same screen officers use. Marks made here are credited to Admin in reports. */
export default async function AdminMarkPage() {
  const admin = await requirePageRole("admin");
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <AttendanceDesk initial={await getDeskData(admin)} />
    </div>
  );
}
