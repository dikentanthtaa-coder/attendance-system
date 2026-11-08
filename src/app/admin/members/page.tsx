import { requirePageRole } from "@/lib/auth";
import { MembersAdmin } from "./members-admin";

export default async function MembersPage() {
  await requirePageRole("admin");
  return <MembersAdmin />;
}
