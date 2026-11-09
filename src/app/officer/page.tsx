import { getDeskData } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import { OfficerApp } from "./officer-app";

export default async function OfficerPage() {
  const officer = await requirePageRole("officer");
  return <OfficerApp displayName={officer.displayName} initial={await getDeskData(officer)} />;
}
