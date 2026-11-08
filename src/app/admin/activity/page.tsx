import { requirePageRole } from "@/lib/auth";
import { ActivityLog } from "./activity-log";

export default async function ActivityPage() {
  await requirePageRole("admin");
  return <ActivityLog />;
}
