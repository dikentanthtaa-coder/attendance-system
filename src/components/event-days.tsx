import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import type { EventSession } from "@/lib/shared";

function DayNumber({ event }: { event: EventSession }) {
  const look =
    event.status === "active" ? "bg-ok text-white" : event.status === "ended" ? "bg-brand text-white" : "bg-active text-ink";
  return (
    <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${look}`}>
      {event.status === "ended" ? <Check size={18} strokeWidth={3} /> : event.event_day}
    </span>
  );
}

/** Officer: choose which day to look at. */
export function EventDayTabs({ events, selectedDay, onSelect }: { events: EventSession[]; selectedDay: number; onSelect: (day: number) => void }) {
  return (
    <nav aria-label="Event days" className="grid grid-cols-3 gap-2">
      {events.map((event) => {
        const selected = event.event_day === selectedDay;
        return (
          <button
            key={event.event_day}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(event.event_day)}
            className={`flex min-h-14 min-w-0 flex-col items-start justify-center gap-1 rounded-control border-2 bg-white px-2 py-1.5 text-left shadow-xs transition-colors duration-150 sm:px-2.5 ${selected ? "border-brand" : "border-transparent hover:border-control"}`}
          >
            <span className="text-sm leading-none font-bold">Day {event.event_day}</span>
            <StatusBadge status={event.status} compact />
          </button>
        );
      })}
    </nav>
  );
}

/** Admin: one day's status, with the action that fits it. */
export function EventDayCard({ event, note, action }: { event: EventSession; note: ReactNode; action?: ReactNode }) {
  return (
    <Card className={event.status === "active" ? "border-ok bg-ok-soft/40" : ""}>
      <article className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <DayNumber event={event} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <h2 className="text-base font-bold">{event.name}</h2>
              <StatusBadge status={event.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted">{note}</p>
          </div>
        </div>
        {action && <div className="mt-auto">{action}</div>}
      </article>
    </Card>
  );
}
