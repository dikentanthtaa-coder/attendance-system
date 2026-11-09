import { getDeskData } from "@/lib/attendance";
import { requirePageRole } from "@/lib/auth";
import type { Gender } from "@/lib/shared";
import { OfficerApp } from "./officer-app";

export default async function OfficerPage() {
  const officer = await requirePageRole("officer");
  return <OfficerApp gender={officer.genderScope as Gender} displayName={officer.displayName} initial={await getDeskData(officer)} />;
}
