"use client";

import { AppShell } from "@/components/ui";
import type { Gender } from "@/lib/shared";
import { AttendanceDesk, type DeskData } from "./attendance-desk";

export function OfficerApp({ gender, displayName, initial }: { gender: Gender; displayName: string; initial: DeskData }) {
  return (
    <AppShell subtitle={displayName} subtitleMore={`${gender} members only`}>
      <AttendanceDesk initial={initial} officerGender={gender} />
    </AppShell>
  );
}
