"use client";

import type { ReactNode } from "react";
import { FileBarChart, LayoutDashboard, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { AppShell, type NavLink } from "@/components/ui";

const LINKS: NavLink[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/mark", label: "Mark Attendance", short: "Mark", icon: UserCheck },
  { href: "/admin/report", label: "Report", icon: FileBarChart },
  { href: "/admin/members", label: "Members", icon: UsersRound },
  { href: "/admin/officers", label: "Officers", icon: ShieldCheck },
];

export function AdminShell({ children }: { children: ReactNode }) {
  return <AppShell subtitle="Admin" links={LINKS}>{children}</AppShell>;
}
