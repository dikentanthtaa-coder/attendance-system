"use client";

import { AppShell } from "@/components/ui";
import { AttendanceDesk, type DeskData } from "./attendance-desk";

export function OfficerApp({ displayName, initial }: { displayName: string; initial: DeskData }) {
  return (
    <AppShell subtitle={`${displayName} · Attendance Officer`} width="narrow">
      <AttendanceDesk initial={initial} />
    </AppShell>
  );
}
