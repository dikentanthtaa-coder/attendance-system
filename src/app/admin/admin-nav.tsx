"use client";

import type { ReactNode } from "react";
import { LayoutDashboard, UsersRound } from "lucide-react";
import { AppShell, type NavLink } from "@/components/ui";

const LINKS: NavLink[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/members", label: "Members", icon: UsersRound },
];

export function AdminShell({ children }: { children: ReactNode }) {
  return <AppShell subtitle="Admin" links={LINKS}>{children}</AppShell>;
}
