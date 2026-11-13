"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus, Pencil, Play, Plus, RotateCcw, Square, Trash2, UserCheck, type LucideIcon } from "lucide-react";
import { EventDayCard } from "@/components/event-days";
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  LinkButton,
  Modal,
  ModalActions,
  PageHeader,
  TextInput,
  useToast,
  type ButtonVariant,
} from "@/components/ui";
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

const NAME_MAX = 60;


/** What the name dialog is for: a new day, another session in a day (such as Evening), or a rename. */
type Naming = { kind: "day" } | { kind: "session"; day: Day } | { kind: "rename"; session: EventSession } | null;

/** A day and its sessions, in order. Days are numbered by position, so removing one leaves no gap. */
type Day = { dayNo: number; label: string; sessions: EventSession[] };

function groupByDay(events: EventSession[]): Day[] {
  const days: Day[] = [];
  for (const event of events) {
    const last = days.at(-1);
    if (last && last.dayNo === event.day_no) last.sessions.push(event);
    else days.push({ dayNo: event.day_no, label: `Day ${days.length + 1}`, sessions: [event] });
  }
  return days;
}

export function EventControls({ initialEvents }: { initialEvents: EventSession[] }) {
  const toast = useToast();
  const [events, setEvents] = useState(initialEvents);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<Naming>(null);
  const [removing, setRemoving] = useState<EventSession | null>(null);

  const active = events.find((e) => e.status === "active");
  const days = groupByDay(events);

  const reload = () => api<{ events: EventSession[] }>("/api/events").then((d) => setEvents(d.events)).catch(() => {});

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const data = await api<{ events: EventSession[] }>(`/api/admin/events/${pending.event.event_day}`, {
        json: { action: pending.action },
      });
      setEvents(data.events);
      toast("success", pending.action === "end" ? `${pending.event.name} ended. Its P and A are ready in Report.` : `${pending.event.name}: started`);
    } catch (err) {
      toast("error", (err as Error).message);
      reload();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const data = await api<{ events: EventSession[] }>(`/api/admin/events/${removing.event_day}`, { method: "DELETE" });
      setEvents(data.events);
      toast("success", `Removed: ${removing.name}`);
    } catch (err) {
      toast("error", (err as Error).message);
      reload();
    } finally {
      setBusy(false);
      setRemoving(null);
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

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Sessions <span className="font-semibold text-muted">({events.length})</span></h2>
        <Button variant="secondary" size="sm" icon={CalendarPlus} onClick={() => setNaming({ kind: "day" })}>New Day</Button>
      </div>

      {/* Each day lists its sessions, such as Morning and Evening, and can take another. Each session has its own attendance. */}
      {days.map((day) => (
      <section key={day.dayNo} aria-label={day.label} className="-mt-1 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-muted">
            {day.label}
            {day.sessions.length > 1 && <span className="font-normal"> · {day.sessions.length} sessions</span>}
          </h3>
          <Button variant="ghost" size="sm" icon={Plus} aria-label={`Add a session to ${day.label}`} onClick={() => setNaming({ kind: "session", day })}>
            Add Session
          </Button>
        </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {day.sessions.map((event, index) => {
          const action: Action = event.status === "not_started" ? "start" : event.status === "active" ? "end" : "restart";
          const blocked = action !== "end" && Boolean(active);
          const look = ACTIONS[action];
          return (
            <EventDayCard
              key={event.event_day}
              event={event}
              number={index + 1}
              note={
                event.status === "active" ? `Started ${formatDateTime(event.started_at)}`
                : event.status === "ended" ? `Ended ${formatDateTime(event.ended_at)}`
                : blocked ? "End the running event before starting this one"
                : "Ready to start"
              }
              tools={
                <>
                  <IconButton icon={Pencil} label={`Rename ${event.name}`} onClick={() => setNaming({ kind: "rename", session: event })} />
                  {/* Only a session that never started can go, so no attendance is ever lost. */}
                  {event.status === "not_started" && events.length > 1 && (
                    <IconButton icon={Trash2} label={`Remove ${event.name}`} danger onClick={() => setRemoving(event)} />
                  )}
                </>
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
      </section>
      ))}

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

      <ConfirmDialog
        open={removing !== null}
        title="Remove session"
        message={removing ? `Remove ${removing.name}? It hasn't started, so no attendance is lost.` : ""}
        confirmLabel="Remove Session"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />

      <Modal
        open={naming !== null}
        onClose={() => setNaming(null)}
        title={naming?.kind === "day" ? "New day" : naming?.kind === "session" ? `Add a session to ${naming.day.label}` : "Rename session"}
      >
        {naming !== null && (
          <SessionNameForm
            key={naming.kind === "rename" ? naming.session.event_day : naming.kind === "session" ? `day-${naming.day.dayNo}` : "day"}
            naming={naming}
            onClose={() => setNaming(null)}
            onSaved={(next, name) => {
              setEvents(next);
              setNaming(null);
              toast("success", naming.kind === "rename" ? `Renamed to ${name}` : `Added: ${name}`);
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function IconButton({ icon: Icon, label, danger, onClick }: { icon: LucideIcon; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-control text-muted lg:size-9 transition-colors duration-150 ${danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-brand-soft hover:text-brand"}`}
    >
      <Icon aria-hidden size={16} />
    </button>
  );
}

function SessionNameForm({
  naming,
  onClose,
  onSaved,
}: {
  naming: Exclude<Naming, null>;
  onClose: () => void;
  onSaved: (events: EventSession[], name: string) => void;
}) {
  const session = naming.kind === "rename" ? naming.session : null;
  const day = naming.kind === "session" ? naming.day : null;
  const [name, setName] = useState(session?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return setError("Please type a name for the session.");
    if (session && clean === session.name) return onClose();
    setBusy(true);
    setError("");
    try {
      const data = session
        ? await api<{ events: EventSession[] }>(`/api/admin/events/${session.event_day}`, { method: "PATCH", json: { name: clean } })
        : await api<{ events: EventSession[] }>("/api/admin/events", { json: { name: clean, dayNo: day?.dayNo } });
      onSaved(data.events, clean);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {naming.kind === "day" && (
        <p className="text-sm text-muted">
          It&apos;s added after the other days as Not Started. To split a day into sessions such as Morning and Evening, use Add Session under that day.
        </p>
      )}
      {day && (
        <p className="text-sm text-muted">
          It&apos;s added to {day.label}, after {day.sessions.length === 1 ? day.sessions[0].name : "its other sessions"}, as Not Started. It has its own attendance, so people are marked again in it.
        </p>
      )}
      <Field label="Session name" htmlFor="session-name">
        <TextInput
          id="session-name"
          placeholder={day ? `e.g. Gyansatra ${day.label} Evening` : "e.g. Gyansatra Day 4"}
          required
          autoFocus
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
        />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" icon={session ? Pencil : day ? Plus : CalendarPlus} loading={busy}>
          {busy ? "Saving…" : session ? "Rename Session" : day ? "Add Session" : "Add Day"}
        </Button>
      </ModalActions>
    </form>
  );
}
