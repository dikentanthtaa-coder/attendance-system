import { requirePageRole } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePageRole("admin");
  return (
    <div className="flex flex-1 flex-col">
      <AdminNav />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 px-4 pt-6 pb-10 md:px-6">{children}</main>
    </div>
  );
}
