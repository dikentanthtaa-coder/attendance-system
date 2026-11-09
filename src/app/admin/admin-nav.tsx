"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton, Mark } from "@/components/ui";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/activity", label: "Activity Log" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 px-4 py-1.5 md:px-6">
        <div className="flex flex-1 items-center gap-3 md:flex-none">
          <Mark />
          <div>
            <p className="font-semibold">Gyansatr Attendance</p>
            <p className="text-xs text-muted">Admin</p>
          </div>
        </div>
        <div className="md:order-last"><LogoutButton /></div>
        <nav aria-label="Admin" className="flex w-full gap-1 overflow-x-auto md:w-auto md:flex-1">
          {LINKS.map((link) => {
            const current = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-control px-3 transition-colors duration-150 ${current ? "bg-active font-semibold" : "text-muted hover:bg-active hover:text-ink"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
