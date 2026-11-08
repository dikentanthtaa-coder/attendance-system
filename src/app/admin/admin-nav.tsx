"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/ui";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/activity", label: "Activity Log" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 pt-2 sm:pb-2">
        <div>
          <p className="text-base font-bold text-brand">Gyansatr Attendance</p>
          <p className="text-xs font-medium text-muted">Admin</p>
        </div>
        <div className="sm:order-last"><LogoutButton /></div>
        <nav aria-label="Admin" className="-mx-1 flex w-full gap-1 overflow-x-auto sm:mx-0 sm:w-auto sm:flex-1">
          {LINKS.map((link) => {
            const current = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${current ? "bg-brand-soft text-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}
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
