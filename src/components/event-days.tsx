import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import type { EventSession } from "@/lib/shared";

function DayNumber({ event, number }: { event: EventSession; number: number }) {
  const look =
    event.status === "active" ? "bg-ok text-white" : event.status === "ended" ? "bg-brand text-white" : "bg-active text-ink";
  return (
    <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${look}`}>
      {event.status === "ended" ? <Check size={18} strokeWidth={3} /> : number}
    </span>
  );
}

/** Officer: choose which day to look at. */
export function EventDayTabs({ events, selectedDay, onSelect }: { events: EventSession[]; selectedDay: number; onSelect: (day: number) => void }) {
  return (
    // Three fit side by side; more scroll sideways instead of squeezing the names.
    <nav aria-label="Event days" className="grid auto-cols-[minmax(5.5rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
      {events.map((event) => {
        const selected = event.event_day === selectedDay;
        // The live day is light green, as on Admin's Dashboard, so it's clear at a glance which one is running.
        const look =
          event.status === "active"
            ? `bg-ok-soft ${selected ? "border-ok" : "border-ok/40 hover:border-ok"}`
            : `bg-white ${selected ? "border-brand" : "border-transparent hover:border-control"}`;
        return (
          <button
            key={event.event_day}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(event.event_day)}
            className={`flex min-h-14 min-w-0 flex-col items-start justify-center gap-1 rounded-control border-2 px-2 py-1.5 text-left shadow-xs transition-colors duration-150 sm:px-2.5 ${look}`}
          >
            <span className="line-clamp-2 text-sm leading-tight font-bold">{event.name}</span>
            <StatusBadge status={event.status} compact />
          </button>
        );
      })}
    </nav>
  );
}

/** Admin: one day's status, with the action that fits it. */
export function EventDayCard({ event, number, note, action, tools }: { event: EventSession; number: number; note: ReactNode; action?: ReactNode; tools?: ReactNode }) {
  return (
    <Card className={event.status === "active" ? "border-ok bg-ok-soft/40" : ""}>
      <article className="flex h-full flex-col gap-3 p-4">
        {/* Name beside the number and tools; status underneath, across the full width so a note isn't squeezed. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5">
          <DayNumber event={event} number={number} />
          <h2 className="self-center text-base leading-snug font-bold break-words">{event.name}</h2>
          {tools ? <div className="-mt-1 -mr-2 flex items-center">{tools}</div> : <span />}
          <div className="col-span-3 flex flex-wrap items-center gap-x-2 gap-y-1 sm:col-span-2 sm:col-start-2">
            <StatusBadge status={event.status} />
            <p className="text-sm text-muted">{note}</p>
          </div>
        </div>
        {action && <div className="mt-auto">{action}</div>}
      </article>
    </Card>
  );
}
