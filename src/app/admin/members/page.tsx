import { requirePageRole } from "@/lib/auth";
import { listMembers } from "@/lib/members";
import { MembersAdmin } from "./members-admin";

export default async function MembersPage() {
  await requirePageRole("admin");
  return <MembersAdmin initial={JSON.parse(JSON.stringify(await listMembers("", 1)))} />;
}
