"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, Button, ConfirmDialog, StatusBadge } from "@/components/ui";
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

  const hasActive = events.some((e) => e.status === "active");

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
    <section aria-label="Event control" className="grid gap-3 sm:grid-cols-3">
      {events.map((event) => {
        const action: Action | null =
          event.status === "not_started" ? "start" : event.status === "active" ? "end" : "restart";
        const blocked = action !== "end" && hasActive;
        return (
          <article key={event.event_day} className={`flex flex-col gap-3 rounded-xl border-2 bg-white p-4 ${event.status === "active" ? "border-ok/50" : "border-line"}`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold">{event.name}</h2>
              <StatusBadge status={event.status} />
            </div>
            <dl className="grid grid-cols-[3rem_1fr] gap-x-2 text-xs text-muted">
              <dt>Start</dt><dd className="text-ink">{formatDateTime(event.started_at)}</dd>
              <dt>End</dt><dd className="text-ink">{formatDateTime(event.ended_at)}</dd>
            </dl>
            <Button
              variant={action === "end" ? "danger" : action === "restart" ? "secondary" : "primary"}
              disabled={blocked}
              title={blocked ? "End the active event first" : undefined}
              onClick={() => setPending({ event, action })}
            >
              {COPY[action].label}
            </Button>
          </article>
        );
      })}
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
