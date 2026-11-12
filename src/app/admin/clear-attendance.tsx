"use client";

import { useState } from "react";
import { Eraser } from "lucide-react";
import { PasswordConfirm } from "@/components/password-confirm";
import { Button, Card, Field, Select, useToast } from "@/components/ui";
import { api } from "@/lib/client-api";
import type { EventSession } from "@/lib/shared";

/** Tells the numbers on the Dashboard to reload now instead of at their next refresh. */
export const ATTENDANCE_CHANGED = "attendance-changed";

/**
 * Rarely needed and can't be undone, so it sits at the foot of the Dashboard, apart from the
 * buttons used every day, and asks for the Admin password.
 */
export function ClearAttendance({ initialEvents }: { initialEvents: EventSession[] }) {
  const toast = useToast();
  const [events, setEvents] = useState(initialEvents);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("all");

  function start() {
    setScope("all");
    setOpen(true);
    // Sessions may have been added or renamed since the page loaded.
    api<{ events: EventSession[] }>("/api/events").then((d) => setEvents(d.events)).catch(() => {});
  }

  /** Throws on a wrong password, so the dialog shows it and stays open. */
  async function clear(password: string) {
    const data = await api<{ cleared: number; session: string | null }>("/api/admin/attendance/clear", {
      json: { password, day: scope === "all" ? "all" : Number(scope) },
    });
    setOpen(false);
    toast("success", `Cleared ${data.cleared} attendance mark${data.cleared === 1 ? "" : "s"} from ${data.session ?? "all sessions"}.`);
    window.dispatchEvent(new Event(ATTENDANCE_CHANGED));
  }

  const target = scope === "all" ? "every session" : (events.find((e) => String(e.event_day) === scope)?.name ?? "this session");

  return (
    <Card aria-label="Clear attendance" className="border-danger/25">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Clear attendance</h2>
          <p className="mt-0.5 text-sm text-muted">Delete marked attendance for one session or all of them. Members and sessions stay. Needs your Admin password.</p>
        </div>
        <Button variant="danger-outline" icon={Eraser} className="shrink-0 max-sm:w-full" onClick={start}>Clear Attendance</Button>
      </div>

      <PasswordConfirm
        open={open}
        title="Clear attendance"
        confirmLabel="Clear Attendance"
        busyLabel="Clearing…"
        icon={Eraser}
        onConfirm={clear}
        onCancel={() => setOpen(false)}
      >
        <Field label="Clear attendance from" htmlFor="clear-scope">
          <Select
            id="clear-scope"
            value={scope}
            onChange={setScope}
            options={[{ value: "all", label: "All sessions" }, ...events.map((e) => ({ value: String(e.event_day), label: e.name }))]}
          />
        </Field>
        <p>
          Every attendance mark from <strong>{target}</strong> is deleted, for all officers. Members and sessions stay. This can&apos;t be undone.
        </p>
      </PasswordConfirm>
    </Card>
  );
}
