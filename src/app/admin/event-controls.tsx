"use client";

import { useState } from "react";
import { Play, RotateCcw, Square, UserCheck, type LucideIcon } from "lucide-react";
import { EventDayCard } from "@/components/event-days";
import { Alert, Button, ConfirmDialog, LinkButton, PageHeader, useToast, type ButtonVariant } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatDateTime, type EventSession } from "@/lib/shared";

type Action = "start" | "end" | "restart";
type Pending = { event: EventSession; action: Action };

const ACTIONS: Record<Action, { title: string; label: string; icon: LucideIcon; variant: ButtonVariant; message: (name: string) => string }> = {
  start: {
    title: "Start event",
    label: "Start Event",
    icon: Play,
    variant: "primary",
    message: (name) => `Start ${name}? Officers will be able to mark attendance right away.`,
  },
  end: {
    title: "End event",
    label: "End Event",
    icon: Square,
    variant: "danger-outline",
    message: (name) => `End ${name}? Attendance marking will stop immediately for all officers.`,
  },
  restart: {
    title: "Restart event",
    label: "Restart Event",
    icon: RotateCcw,
    variant: "secondary",
    message: (name) => `${name} has ended. Restart it only if it was ended by mistake. Officers will be able to mark attendance again.`,
  },
};

export function EventControls({ initialEvents }: { initialEvents: EventSession[] }) {
  const toast = useToast();
  const [events, setEvents] = useState(initialEvents);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const active = events.find((e) => e.status === "active");

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const data = await api<{ events: EventSession[] }>(`/api/admin/events/${pending.event.event_day}`, {
        json: { action: pending.action },
      });
      setEvents(data.events);
      toast("success", `${pending.event.name}: ${pending.action === "end" ? "ended" : "started"}`);
    } catch (err) {
      toast("error", (err as Error).message);
      api<{ events: EventSession[] }>("/api/events").then((d) => setEvents(d.events)).catch(() => {});
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <section aria-label="Event control" className="flex flex-col gap-4">
      <PageHeader title="Dashboard" description="Run each day of the event and watch attendance as it comes in." />

      <Alert
        tone={active ? "ok" : "info"}
        title={active ? `${active.name} is running. Attendance can be marked.` : "No event is running, so attendance can't be marked."}
        action={active && <LinkButton href="/admin/mark" variant="primary" size="sm" icon={UserCheck}>Mark Attendance</LinkButton>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {events.map((event) => {
          const action: Action = event.status === "not_started" ? "start" : event.status === "active" ? "end" : "restart";
          const blocked = action !== "end" && Boolean(active);
          const look = ACTIONS[action];
          return (
            <EventDayCard
              key={event.event_day}
              event={event}
              note={
                event.status === "active" ? `Started ${formatDateTime(event.started_at)}`
                : event.status === "ended" ? `Ended ${formatDateTime(event.ended_at)}`
                : blocked ? `End Day ${active!.event_day} before starting this day`
                : "Ready to start"
              }
              action={
                // Shown even when blocked, so Admin can see the action exists and why it's unavailable.
                <Button variant={look.variant} icon={look.icon} disabled={blocked} className="w-full" onClick={() => setPending({ event, action })}>
                  {look.label}
                </Button>
              }
            />
          );
        })}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTIONS[pending.action].title : ""}
        message={pending ? ACTIONS[pending.action].message(pending.event.name) : ""}
        confirmLabel={pending ? ACTIONS[pending.action].label : ""}
        danger={pending?.action === "end"}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
