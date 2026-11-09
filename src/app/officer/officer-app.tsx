"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Search, UserPlus } from "lucide-react";
import { useToast } from "@/components/toast";
import { api, Button, ClientApiError, ErrorNote, inputClass, LogoutButton, Mark, StatusLabel } from "@/components/ui";
import { formatTime, STATUS_LABEL, type EventSession, type Gender } from "@/lib/shared";
import { QuickEntryPanel, type QuickEntryPrefill } from "./quick-entry-panel";

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

type Marked = { key: number; label: string; name: string; id: string | null; at: string };

const POLL_MS = 5000;
const RECENT_LIMIT = 5;

export function OfficerApp({ gender, displayName, initialEvents }: { gender: Gender; displayName: string; initialEvents: EventSession[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // null means "follow whichever event is active".
  const [chosenDay, setChosenDay] = useState<number | null>(null);

  const activeDay = events.find((e) => e.status === "active")?.event_day ?? null;
  const selectedDay = chosenDay ?? activeDay ?? 1;
  const selected = events.find((e) => e.event_day === selectedDay)!;
  const count = counts[selectedDay] ?? 0;

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
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-2">
          <Mark />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Gyansatr Attendance</p>
            <p className="text-xs text-muted">{displayName} · {gender} members only</p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        {/* The three-day strip: the one element that belongs only to this event. */}
        <nav aria-label="Event days" className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-card border border-line bg-canvas">
          {events.map((event) => {
            const isSelected = event.event_day === selectedDay;
            return (
              <button
                key={event.event_day}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setChosenDay(event.event_day)}
                className={`relative flex min-h-16 flex-col justify-center gap-0.5 px-3 py-2 text-left transition-colors duration-150 ${isSelected ? "bg-white" : "hover:bg-active"}`}
              >
                {isSelected && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand" />}
                <span className={`text-base ${isSelected ? "font-semibold" : "font-medium"}`}>Day {event.event_day}</span>
                <StatusLabel status={event.status} />
              </button>
            );
          })}
        </nav>

        {selected.status === "active" ? (
          <MarkingPanel
            key={selectedDay}
            event={selected}
            gender={gender}
            count={count}
            onEventChanged={() => refreshEvents().catch(() => {})}
            onMarked={() => setCounts((c) => ({ ...c, [selectedDay]: (c[selectedDay] ?? 0) + 1 }))}
          />
        ) : (
          <div className="flex flex-col items-start gap-1 py-6">
            <h1 className="text-xl font-semibold">{selected.name} is {STATUS_LABEL[selected.status]}</h1>
            <p className="text-muted">
              {selected.status === "ended"
                ? "This event has ended, so attendance can no longer be marked."
                : "Attendance can be marked after Admin starts this event."}
            </p>
            {count > 0 && <p className="text-muted">{count} {gender.toLowerCase()} members were marked present.</p>}
            {activeDay && (
              <Button className="mt-3" onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>
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
}: {
  event: EventSession;
  gender: Gender;
  count: number;
  onEventChanged: () => void;
  onMarked: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<QuickEntryPrefill | null>(null);
  const [recent, setRecent] = useState<Marked[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const trimmed = query.trim();
  const showResults = trimmed !== "" && resultsFor === trimmed;
  const searching = trimmed !== "" && resultsFor !== trimmed && !searchError;
  const onlyOne = showResults && results.length === 1 && !results[0].present_at;

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

  const remember = (label: string, name: string, id: string | null, at: string) => {
    nextKey.current += 1;
    const entry = { key: nextKey.current, label, name, id, at };
    setRecent((rows) => [entry, ...rows].slice(0, RECENT_LIMIT));
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
        remember("Present", res.memberName, member.global_member_id, res.markedAt);
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

  const heading = (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="text-xl font-semibold">Marking {event.name}</h1>
      <p className="whitespace-nowrap text-muted" data-testid="present-count">
        <span className="text-xl font-semibold text-ink">{count}</span> {gender.toLowerCase()} present
      </p>
    </div>
  );

  if (prefill) {
    return (
      <section className="flex flex-col gap-4">
        {heading}
        <QuickEntryPanel
          prefill={prefill}
          event={event}
          gender={gender}
          onCancel={() => setPrefill(null)}
          onSaved={(name, at) => {
            setPrefill(null);
            remember("Added and marked present", name, null, at);
            onMarked();
            setQuery("");
            setResults([]);
            setResultsFor("");
          }}
          onEventChanged={onEventChanged}
        />
      </section>
    );
  }

  const [latest, ...earlier] = recent;

  return (
    <section className="flex flex-col gap-4" aria-label={`Mark attendance for ${event.name}`}>
      {heading}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-search" className="text-sm font-medium">Search by Member ID, name or mobile</label>
        <div className="relative">
          <Search aria-hidden size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            id="member-search"
            ref={inputRef}
            type="search"
            autoFocus
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            placeholder="2051, ram pat, or 98765"
            className={`${inputClass} min-h-13 pl-10 text-lg`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchError("");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !showResults) return;
              e.preventDefault();
              // Enter marks only when there's exactly one candidate, so it can never pick the wrong person.
              if (onlyOne) mark(results[0]);
            }}
          />
        </div>
      </div>

      {searchError && <ErrorNote>{searchError}</ErrorNote>}

      {!trimmed && latest && (
        // Next to the search box, because a phone's keyboard can hide anything lower down.
        <div key={latest.key} role="status" className="rise-in flex items-center gap-2.5 rounded-card bg-ok-soft px-3 py-2.5 text-ok">
          <CircleCheck aria-hidden size={20} className="shrink-0" />
          <p className="min-w-0 flex-1 font-semibold break-words">{latest.label}: {latest.name}</p>
          <span className="shrink-0 text-sm">{formatTime(latest.at)}</span>
        </div>
      )}

      {!trimmed && earlier.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted">Marked before that</h2>
          <ul className="divide-y divide-rule rounded-card border border-line bg-white">
            {earlier.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 break-words">{row.name}</span>
                <span className="shrink-0 text-muted">{formatTime(row.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showResults && results.length > 0 && (
        <ul className="divide-y divide-rule rounded-card border border-line bg-white">
          {results.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold break-words">{member.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-muted">
                  {member.global_member_id && <span className="font-medium text-ink">{member.global_member_id}</span>}
                  <span>{member.mobile}</span>
                  <span>{member.center}</span>
                </p>
              </div>
              {member.present_at ? (
                <span className="shrink-0 rounded-control bg-warn-soft px-2.5 py-1 text-center text-xs font-semibold text-warn">
                  Already Present
                  <span className="block font-normal">{formatTime(member.present_at)}</span>
                </span>
              ) : (
                // A row of solid buttons would out-shout the names, so only a single match gets one.
                <Button variant={onlyOne ? "primary" : "outline"} className="shrink-0 px-3" disabled={markingId !== null} onClick={() => mark(member)}>
                  {markingId === member.id ? "Saving…" : "Mark Present"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showResults && results.length === 0 && (
        <p className="text-muted">No {gender.toLowerCase()} member matches “{trimmed}”. If they are new, add them below.</p>
      )}

      {searching && <p className="text-muted">Searching…</p>}

      <Button variant={showResults && results.length === 0 ? "primary" : "secondary"} className="self-start" onClick={openQuickEntry}>
        <UserPlus aria-hidden size={16} />
        Quick Entry: add new {gender.toLowerCase()} member
      </Button>
    </section>
  );
}
