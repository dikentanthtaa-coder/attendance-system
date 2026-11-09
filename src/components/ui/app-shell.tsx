"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut, type LucideIcon } from "lucide-react";
import { Button } from "./button";

/** The app's mark: three strokes for the three days. */
export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" fill="#fff" />
      <path d="M9 10v12M23 10v12" stroke="var(--color-brand)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M16 10v12" stroke="var(--color-accent)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="on-dark"
      icon={LogOut}
      aria-label="Log out"
      className="px-3"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <span className="hidden sm:inline">Log out</span>
    </Button>
  );
}

export type NavLink = { href: string; label: string; icon: LucideIcon };

const WIDTHS = { wide: "max-w-[1280px]", narrow: "max-w-2xl" } as const;

/** The frame every signed-in screen sits in, so all roles share one header and one page width. */
export function AppShell({
  subtitle,
  links,
  width = "wide",
  children,
}: {
  subtitle: string;
  links?: NavLink[];
  width?: keyof typeof WIDTHS;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-brand-deep text-white shadow-md md:sticky md:top-0 md:z-30">
        <div className={`mx-auto flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:px-6 ${WIDTHS[width]}`}>
          <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
            <Logo />
            <div className="min-w-0">
              <p className="truncate text-base leading-tight font-bold">Gyansatr Attendance</p>
              <p className="truncate text-xs text-white/85">{subtitle}</p>
            </div>
          </div>
          <div className="md:order-last"><LogoutButton /></div>
          {links && (
            <nav aria-label="Admin" className="flex w-full gap-1 md:w-auto md:flex-1">
              {links.map(({ href, label, icon: Icon }) => {
                const current = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 md:flex-none ${current ? "bg-white text-brand-dark" : "text-white hover:bg-white/15"}`}
                  >
                    <Icon aria-hidden size={16} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </header>
      <main className={`mx-auto flex w-full flex-1 flex-col gap-5 px-4 pt-5 pb-10 md:px-6 ${WIDTHS[width]}`}>{children}</main>
    </div>
  );
}
