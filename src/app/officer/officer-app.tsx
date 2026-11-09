"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, Hash, History, Lock, MapPin, Phone, Search, UserPlus } from "lucide-react";
import { EventDayTabs } from "@/components/event-days";
import { Alert, AppShell, Badge, Button, Card, CardHeader, EmptyState, Field, MetaList, PersonRow, SearchInput, Spinner, useToast } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
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

type Marked = { key: number; label: string; name: string; at: string };

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
    <AppShell subtitle={`${displayName} · ${gender} members only`} width="narrow">
      <EventDayTabs events={events} selectedDay={selectedDay} onSelect={setChosenDay} />

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
        <Card>
          <EmptyState
            icon={selected.status === "ended" ? Lock : CalendarClock}
            titleAs="h1"
            title={`${selected.name} is ${STATUS_LABEL[selected.status]}`}
            description={
              <>
                {selected.status === "ended"
                  ? "This event has ended, so attendance can no longer be marked."
                  : "Attendance can be marked after Admin starts this event."}
                {count > 0 && ` ${count} ${gender.toLowerCase()} members were marked present.`}
              </>
            }
            action={activeDay && <Button onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>}
          />
        </Card>
      )}
    </AppShell>
  );
}

function MarkingHeading({ event, gender, count }: { event: EventSession; gender: Gender; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-brand px-4 py-2.5 text-white">
      <h1 className="text-lg leading-tight font-bold">Marking {event.name}</h1>
      <p className="flex shrink-0 items-baseline gap-1.5" data-testid="present-count">
        <span className="text-3xl leading-none font-bold">{count}</span>
        <span className="text-sm text-white/85">{gender.toLowerCase()} present</span>
      </p>
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
  const noMatches = showResults && results.length === 0;
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

  const remember = (label: string, name: string, at: string) => {
    nextKey.current += 1;
    const entry = { key: nextKey.current, label, name, at };
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
        remember("Present", res.memberName, res.markedAt);
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

  if (prefill) {
    return (
      <>
        <Card className="overflow-hidden">
          <MarkingHeading event={event} gender={gender} count={count} />
        </Card>
        <QuickEntryPanel
          prefill={prefill}
          event={event}
          gender={gender}
          onCancel={() => setPrefill(null)}
          onSaved={(name, at) => {
            setPrefill(null);
            remember("Added and marked present", name, at);
            onMarked();
            setQuery("");
            setResults([]);
            setResultsFor("");
          }}
          onEventChanged={onEventChanged}
        />
      </>
    );
  }

  const [latest, ...earlier] = recent;

  return (
    <>
      <Card aria-label={`Mark attendance for ${event.name}`} className="overflow-hidden">
        <MarkingHeading event={event} gender={gender} count={count} />
        <div className="p-4">
          <Field label="Search by Member ID, name or mobile" htmlFor="member-search">
            <SearchInput
              id="member-search"
              large
              inputRef={inputRef}
              autoFocus
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              placeholder="2051, ram pat, or 98765"
              value={query}
              onClear={clearSearch}
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
          </Field>
        </div>
      </Card>

      {searchError && <Alert tone="danger" title={searchError} />}

      {!trimmed && latest && (
        // Next to the search box, because a phone's keyboard can hide anything lower down.
        <Alert key={latest.key} tone="ok" role="status" className="rise-in" title={`${latest.label}: ${latest.name}`} action={<span className="text-sm font-semibold text-ok">{formatTime(latest.at)}</span>} />
      )}

      {searching && (
        <p className="flex items-center justify-center gap-2 py-3 text-muted">
          <Spinner />
          Searching…
        </p>
      )}

      {showResults && results.length > 0 && (
        <Card aria-label="Search results" className="overflow-hidden">
          <ul className="divide-y divide-rule">
            {results.map((member) => (
              <li key={member.id}>
                <PersonRow
                  name={member.name}
                  gender={gender}
                  hideAvatarOnPhone
                  meta={
                    <MetaList
                      items={[
                        member.global_member_id ? { icon: Hash, label: member.global_member_id, strong: true } : null,
                        { icon: Phone, label: member.mobile },
                        { icon: MapPin, label: member.center },
                      ]}
                    />
                  }
                  actions={
                    member.present_at ? (
                      <span className="flex flex-col items-center gap-0.5 text-center">
                        <Badge tone="warn" icon={CircleCheck}>Already Present</Badge>
                        <span className="text-xs text-muted">{formatTime(member.present_at)}</span>
                      </span>
                    ) : (
                      <Button variant="success" icon={CircleCheck} className="px-3" loading={markingId === member.id} disabled={markingId !== null} onClick={() => mark(member)}>
                        Mark Present
                      </Button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {noMatches && (
        <Card>
          <EmptyState
            icon={Search}
            titleAs="p"
            title={`No ${gender.toLowerCase()} member matches “${trimmed}”`}
            description="Check the spelling or try the mobile number. If they are new, add them with Quick Entry."
          />
        </Card>
      )}

      {!trimmed && !latest && (
        <Card>
          <EmptyState icon={Search} titleAs="p" title="Ready for the next person" description="Type at least part of their Member ID, name or mobile number." />
        </Card>
      )}

      <Button variant={noMatches ? "primary" : "secondary"} icon={UserPlus} size="lg" className="w-full" onClick={openQuickEntry}>
        Quick Entry: add new {gender.toLowerCase()} member
      </Button>

      {!trimmed && earlier.length > 0 && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><History aria-hidden size={16} className="text-muted" />Marked before that</span>} />
          <ul className="divide-y divide-rule">
            {earlier.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
                <span className="min-w-0 font-medium break-words">{row.name}</span>
                <span className="shrink-0 text-sm text-muted">{formatTime(row.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
