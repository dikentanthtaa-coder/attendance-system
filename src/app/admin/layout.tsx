import { requirePageRole } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePageRole("admin");
  return (
    <div className="flex flex-1 flex-col">
      <AdminNav />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 p-4">{children}</main>
    </div>
  );
}
