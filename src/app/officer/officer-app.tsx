"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { api, Button, ClientApiError, inputClass, LogoutButton, StatusBadge } from "@/components/ui";
import { formatTime, STATUS_LABEL, type EventSession, type Gender } from "@/lib/shared";
import { QuickEntryDialog, type QuickEntryPrefill } from "./quick-entry-dialog";

type SearchResult = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string;
  center: string;
  present_at: string | null;
  present_marked_by: string | null;
};

type MarkResponse = { status: "marked" | "already_present"; memberName: string; markedAt: string; markedBy: string };

const POLL_MS = 5000;

export function OfficerApp({ gender, displayName, initialEvents }: { gender: Gender; displayName: string; initialEvents: EventSession[] }) {
  const toast = useToast();
  const [events, setEvents] = useState(initialEvents);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // null means "follow whichever event is active".
  const [chosenDay, setChosenDay] = useState<number | null>(null);

  const activeDay = events.find((e) => e.status === "active")?.event_day ?? null;
  const selectedDay = chosenDay ?? activeDay ?? 1;
  const selected = events.find((e) => e.event_day === selectedDay)!;
  const canMark = selected.status === "active";

  const lastActiveDay = useRef(activeDay);

  const refreshEvents = useCallback(async () => {
    const data = await api<{ events: EventSession[]; counts: Record<string, number> }>("/api/events");
    setEvents(data.events);
    setCounts(data.counts);
    const nowActive = data.events.find((e) => e.status === "active")?.event_day ?? null;
    if (nowActive !== lastActiveDay.current) {
      lastActiveDay.current = nowActive;
      // Admin changed the active event: stop looking at the old one.
      setChosenDay(null);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refreshEvents().catch(() => {});
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshEvents]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-brand">Gyansatr Attendance</h1>
            <p className="text-xs font-medium text-muted">{displayName} · {gender} members only</p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <nav aria-label="Event days" className="grid grid-cols-3 gap-2">
          {events.map((event) => {
            const isSelected = event.event_day === selectedDay;
            return (
              <button
                key={event.event_day}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setChosenDay(event.event_day)}
                className={`flex min-h-16 flex-col items-start gap-1.5 rounded-xl border-2 bg-white p-2.5 text-left transition-colors sm:p-3 ${isSelected ? "border-brand" : "border-line hover:border-muted"}`}
              >
                <span className="text-xs font-medium text-muted sm:text-sm">Gyansatr</span>
                <span className="-mt-1 text-base font-bold">Day {event.event_day}</span>
                <StatusBadge status={event.status} />
              </button>
            );
          })}
        </nav>

        {canMark ? (
          <MarkingPanel
            key={selectedDay}
            event={selected}
            gender={gender}
            count={counts[selectedDay] ?? 0}
            onEventChanged={() => refreshEvents().catch(() => {})}
            onMarked={() => setCounts((c) => ({ ...c, [selectedDay]: (c[selectedDay] ?? 0) + 1 }))}
            toast={toast}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white px-6 py-10 text-center">
            <p className="text-base font-semibold">{selected.name} is {STATUS_LABEL[selected.status]}</p>
            <p className="max-w-sm text-sm text-muted">
              {selected.status === "ended"
                ? "This event has ended, so attendance can no longer be marked."
                : "Attendance can be marked after Admin starts this event."}
            </p>
            {activeDay && (
              <Button className="mt-2" onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>
            )}
            {selected.status !== "active" && (counts[selectedDay] ?? 0) > 0 && (
              <p className="mt-1 text-sm text-muted">{counts[selectedDay]} {gender.toLowerCase()} members were marked present.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MarkingPanel({
  event,
  gender,
  count,
  onEventChanged,
  onMarked,
  toast,
}: {
  event: EventSession;
  gender: Gender;
  count: number;
  onEventChanged: () => void;
  onMarked: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<QuickEntryPrefill | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const showResults = trimmed !== "" && resultsFor === trimmed;
  const searching = trimmed !== "" && resultsFor !== trimmed && !searchError;

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    // A short pause so each keystroke doesn't send its own request, and an abort so slow responses can't overwrite newer ones.
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ results: SearchResult[] }>(
          `/api/officer/search?day=${event.event_day}&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        setResults(data.results);
        setResultsFor(trimmed);
        setSearchError("");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSearchError((err as Error).message);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, event.event_day]);

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setResultsFor("");
    setSearchError("");
    inputRef.current?.focus();
  };

  async function mark(member: SearchResult) {
    if (markingId !== null) return;
    setMarkingId(member.id);
    try {
      const res = await api<MarkResponse>("/api/officer/attendance", {
        json: { memberId: member.id, eventDay: event.event_day },
      });
      if (res.status === "already_present") {
        toast("warning", `Already Present: ${res.memberName} (${formatTime(res.markedAt)})`);
        setResults((rows) =>
          rows.map((r) => (r.id === member.id ? { ...r, present_at: res.markedAt, present_marked_by: res.markedBy } : r)),
        );
      } else {
        toast("success", `Present: ${res.memberName}`);
        onMarked();
        clearSearch();
      }
    } catch (err) {
      toast("error", (err as Error).message);
      if (err instanceof ClientApiError && err.code === "event_not_active") onEventChanged();
    } finally {
      setMarkingId(null);
    }
  }

  function openQuickEntry() {
    const digits = trimmed.replace(/[\s+-]/g, "");
    if (/^\d{10,}$/.test(digits)) setPrefill({ mobile: digits });
    else if (/^\d/.test(trimmed)) setPrefill({ globalMemberId: trimmed });
    else setPrefill({ name: trimmed });
  }

  return (
    <section className="flex flex-col gap-3" aria-label={`Mark attendance for ${event.name}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Marking {event.name}</h2>
        <p className="text-sm text-muted" data-testid="present-count">
          <span className="font-semibold tabular-nums text-ink">{count}</span> {gender.toLowerCase()} present
        </p>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          autoFocus
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          aria-label="Search by Member ID, name or mobile number"
          placeholder="Member ID, name or mobile"
          className={`${inputClass} min-h-13 text-lg`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchError("");
          }}
          onKeyDown={(e) => {
            // Enter marks only when there's exactly one candidate, so it can never pick the wrong person.
            if (e.key !== "Enter" || !showResults) return;
            e.preventDefault();
            if (results.length === 1 && !results[0].present_at) mark(results[0]);
          }}
        />
      </div>

      {searchError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{searchError}</p>}

      {showResults && results.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {results.map((member) => (
            <li key={member.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words">{member.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                  {member.global_member_id && <span className="font-mono font-medium text-ink">{member.global_member_id}</span>}
                  <span className="font-mono">{member.mobile}</span>
                  <span>{member.center}</span>
                </p>
              </div>
              {member.present_at ? (
                <span className="shrink-0 rounded-lg bg-warn-soft px-2.5 py-1.5 text-center text-xs font-semibold text-warn">
                  Already Present
                  <span className="block font-normal">{formatTime(member.present_at)}</span>
                </span>
              ) : (
                <Button className="shrink-0" disabled={markingId !== null} onClick={() => mark(member)}>
                  {markingId === member.id ? "Saving…" : "Mark Present"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showResults && results.length === 0 && (
        <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-sm text-muted">
          No {gender.toLowerCase()} member matches “{trimmed}”.
        </p>
      )}

      {searching && <p className="px-1 text-sm text-muted">Searching…</p>}

      <Button variant="secondary" className="self-center" onClick={openQuickEntry}>
        + Quick Entry: add new {gender.toLowerCase()} member
      </Button>

      <QuickEntryDialog
        open={prefill !== null}
        prefill={prefill ?? {}}
        event={event}
        gender={gender}
        onClose={() => setPrefill(null)}
        onSaved={(name) => {
          setPrefill(null);
          toast("success", `Added and marked present: ${name}`);
          onMarked();
          clearSearch();
        }}
        onEventChanged={onEventChanged}
      />
    </section>
  );
}
