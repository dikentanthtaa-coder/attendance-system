"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, Button, ConfirmDialog, StatusLabel } from "@/components/ui";
import { formatDateTime, type EventSession } from "@/lib/shared";

type Action = "start" | "end" | "restart";
type Pending = { event: EventSession; action: Action };

const COPY: Record<Action, { title: string; label: string; message: (name: string) => string }> = {
  start: {
    title: "Start event",
    label: "Start Event",
    message: (name) => `Start ${name}? Officers will be able to mark attendance right away.`,
  },
  end: {
    title: "End event",
    label: "End Event",
    message: (name) => `End ${name}? Attendance marking will stop immediately for all officers.`,
  },
  restart: {
    title: "Restart event",
    label: "Restart Event",
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
    <section aria-label="Event control" className="flex flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted" data-testid="event-summary">
          {active ? `${active.name} is running. Officers can mark attendance.` : "No event is running, so officers can't mark attendance."}
        </p>
      </div>

      {/* The three-day strip: one object with three states, not three separate cards. */}
      <div className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {events.map((event) => {
          const action: Action = event.status === "not_started" ? "start" : event.status === "active" ? "end" : "restart";
          const blocked = action !== "end" && Boolean(active);
          return (
            <article key={event.event_day} className={`flex flex-col gap-1.5 p-3 sm:gap-2 sm:p-4 ${event.status === "active" ? "bg-ok-soft/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{event.name}</h2>
                <StatusLabel status={event.status} />
              </div>
              <p className="min-h-5 text-muted">
                {event.status === "active" && `Started ${formatDateTime(event.started_at)}`}
                {event.status === "ended" && `Ended ${formatDateTime(event.ended_at)}`}
                {event.status === "not_started" && !blocked && "Ready to start"}
                {event.status === "not_started" && blocked && `End Day ${active!.event_day} before starting this day`}
              </p>
              {!blocked && (
                <Button
                  variant={action === "end" ? "danger-outline" : action === "restart" ? "secondary" : "primary"}
                  className="mt-auto self-start"
                  onClick={() => setPending({ event, action })}
                >
                  {COPY[action].label}
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? COPY[pending.action].title : ""}
        message={pending ? COPY[pending.action].message(pending.event.name) : ""}
        confirmLabel={pending ? COPY[pending.action].label : ""}
        danger={pending?.action === "end"}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
