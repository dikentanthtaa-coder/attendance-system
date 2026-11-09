import { requirePageRole } from "@/lib/auth";
import { OfficersAdmin } from "./officers-admin";

export default async function OfficersPage() {
  await requirePageRole("admin");
  return <OfficersAdmin />;
}
