import { requirePageRole } from "@/lib/auth";
import { AdminShell } from "./admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePageRole("admin");
  return <AdminShell>{children}</AdminShell>;
}
