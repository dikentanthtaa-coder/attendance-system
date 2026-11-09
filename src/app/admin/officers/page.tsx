import { requirePageRole } from "@/lib/auth";
import { listOfficers } from "@/lib/officers";
import { OfficersAdmin } from "./officers-admin";

export default async function OfficersPage() {
  await requirePageRole("admin");
  return <OfficersAdmin initial={JSON.parse(JSON.stringify(await listOfficers()))} />;
}
