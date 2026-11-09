"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, CircleX, Hash, History, Lock, MapPin, Phone, Search, UserPlus } from "lucide-react";
import { EventDayTabs } from "@/components/event-days";
import { Alert, AppShell, AttendanceBadge, Badge, Button, Card, CardHeader, EmptyState, Field, GenderBadge, MetaList, PersonRow, SearchInput, Spinner, useToast } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { formatTime, STATUS_LABEL, type AttendanceStatus, type EventSession, type Gender } from "@/lib/shared";
import { QuickEntryPanel, type QuickEntryPrefill } from "./quick-entry-panel";

type SearchResult = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string;
  gender: Gender;
  center: string;
  attendance_status: AttendanceStatus | null;
  marked_at: string | null;
  marked_by: string | null;
};

type MarkResponse = { status: "marked" | "already_present" | "already_absent"; memberName: string; markedAt: string; markedBy: string };

type Marked = { key: number; status: AttendanceStatus; label: string; name: string; at: string };

type DayCount = { present: number; absent: number };

const POLL_MS = 5000;
const RECENT_LIMIT = 5;
const NO_COUNT: DayCount = { present: 0, absent: 0 };

export function OfficerApp({ displayName, initialEvents }: { displayName: string; initialEvents: EventSession[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [counts, setCounts] = useState<Record<string, DayCount>>({});
  // null means "follow whichever event is active".
  const [chosenDay, setChosenDay] = useState<number | null>(null);

  const activeDay = events.find((e) => e.status === "active")?.event_day ?? null;
  const selectedDay = chosenDay ?? activeDay ?? 1;
  const selected = events.find((e) => e.event_day === selectedDay)!;
  const count = counts[selectedDay] ?? NO_COUNT;

  const lastActiveDay = useRef(activeDay);

  const refreshEvents = useCallback(async () => {
    const data = await api<{ events: EventSession[]; counts: Record<string, DayCount> }>("/api/events");
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
    <AppShell subtitle={`${displayName} · Attendance Officer`} width="narrow">
      <EventDayTabs events={events} selectedDay={selectedDay} onSelect={setChosenDay} />

      {selected.status === "active" ? (
        <MarkingPanel
          key={selectedDay}
          event={selected}
          count={count}
          onChanged={() => refreshEvents().catch(() => {})}
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
                {count.present + count.absent > 0 && ` ${count.present} present and ${count.absent} absent were marked.`}
              </>
            }
            action={activeDay && <Button onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>}
          />
        </Card>
      )}
    </AppShell>
  );
}

function MarkingHeading({ event, count }: { event: EventSession; count: DayCount }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-brand px-4 py-2.5 text-white">
      <h1 className="text-lg leading-tight font-bold">Marking {event.name}</h1>
      <p className="flex shrink-0 items-baseline gap-1.5" data-testid="present-count">
        <span className="text-3xl leading-none font-bold">{count.present}</span>
        <span className="text-sm text-white/85">present · {count.absent} absent</span>
      </p>
    </div>
  );
}

function MarkingPanel({ event, count, onChanged }: { event: EventSession; count: DayCount; onChanged: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [marking, setMarking] = useState<{ id: number; status: AttendanceStatus } | null>(null);
  const [prefill, setPrefill] = useState<QuickEntryPrefill | null>(null);
  const [recent, setRecent] = useState<Marked[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const trimmed = query.trim();
  const showResults = trimmed !== "" && resultsFor === trimmed;
  const searching = trimmed !== "" && resultsFor !== trimmed && !searchError;
  const noMatches = showResults && results.length === 0;
  const onlyOne = showResults && results.length === 1 && results[0].attendance_status !== "present";

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

  const remember = (status: AttendanceStatus, label: string, name: string, at: string) => {
    nextKey.current += 1;
    const entry = { key: nextKey.current, status, label, name, at };
    setRecent((rows) => [entry, ...rows].slice(0, RECENT_LIMIT));
  };

  async function mark(member: SearchResult, status: AttendanceStatus) {
    if (marking) return;
    setMarking({ id: member.id, status });
    try {
      const res = await api<MarkResponse>("/api/officer/attendance", {
        json: { memberId: member.id, eventDay: event.event_day, status },
      });
      if (res.status === "marked") {
        remember(status, status === "present" ? "Present" : "Absent", res.memberName, res.markedAt);
        onChanged();
        clearSearch();
      } else {
        // Someone else got there first, or this would undo Present, which only Admin can do.
        const nowStatus: AttendanceStatus = res.status === "already_present" ? "present" : "absent";
        toast("warning", `Already ${nowStatus === "present" ? "Present" : "Absent"}: ${res.memberName} (${formatTime(res.markedAt)})`);
        setResults((rows) =>
          rows.map((r) => (r.id === member.id ? { ...r, attendance_status: nowStatus, marked_at: res.markedAt, marked_by: res.markedBy } : r)),
        );
      }
    } catch (err) {
      toast("error", (err as Error).message);
      if (err instanceof ClientApiError && err.code === "event_not_active") onChanged();
    } finally {
      setMarking(null);
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
          <MarkingHeading event={event} count={count} />
        </Card>
        <QuickEntryPanel
          prefill={prefill}
          event={event}
          onCancel={() => setPrefill(null)}
          onSaved={(name, at) => {
            setPrefill(null);
            remember("present", "Added and marked present", name, at);
            onChanged();
            setQuery("");
            setResults([]);
            setResultsFor("");
          }}
          onEventChanged={onChanged}
        />
      </>
    );
  }

  const [latest, ...earlier] = recent;

  return (
    <>
      <Card aria-label={`Mark attendance for ${event.name}`} className="overflow-hidden">
        <MarkingHeading event={event} count={count} />
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
                // Enter marks Present only when there's exactly one candidate, so it can never pick the wrong person.
                if (onlyOne) mark(results[0], "present");
              }}
            />
          </Field>
        </div>
      </Card>

      {searchError && <Alert tone="danger" title={searchError} />}

      {!trimmed && latest && (
        // Next to the search box, because a phone's keyboard can hide anything lower down.
        <Alert
          key={latest.key}
          tone={latest.status === "present" ? "ok" : "warn"}
          role="status"
          className="rise-in"
          title={`${latest.label}: ${latest.name}`}
          action={<span className={`text-sm font-semibold ${latest.status === "present" ? "text-ok" : "text-warn"}`}>{formatTime(latest.at)}</span>}
        />
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
                  gender={member.gender}
                  hideAvatarOnPhone
                  actionsBelowOnPhone={member.attendance_status !== "present"}
                  meta={
                    <MetaList
                      items={[
                        member.global_member_id ? { icon: Hash, label: member.global_member_id, strong: true } : null,
                        { icon: Phone, label: member.mobile },
                        { icon: MapPin, label: member.center },
                      ]}
                    />
                  }
                  footer={
                    <>
                      <GenderBadge gender={member.gender} />
                      {member.attendance_status === "absent" && <AttendanceBadge status="absent" />}
                    </>
                  }
                  actions={<RowActions member={member} marking={marking} onMark={mark} />}
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
            title={`No member matches “${trimmed}”`}
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
        Quick Entry: add new member
      </Button>

      {!trimmed && earlier.length > 0 && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><History aria-hidden size={16} className="text-muted" />Marked before that</span>} />
          <ul className="divide-y divide-rule">
            {earlier.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
                <span className="min-w-0 font-medium break-words">{row.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
                  <AttendanceBadge status={row.status} />
                  {formatTime(row.at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * Present is final for an officer, so it shows no buttons at all. Absent can still become Present,
 * for someone who arrives late. Only Admin can do anything else.
 */
function RowActions({
  member,
  marking,
  onMark,
}: {
  member: SearchResult;
  marking: { id: number; status: AttendanceStatus } | null;
  onMark: (member: SearchResult, status: AttendanceStatus) => void;
}) {
  const busy = (status: AttendanceStatus) => marking?.id === member.id && marking.status === status;

  if (member.attendance_status === "present") {
    return (
      <span className="flex flex-col items-center gap-0.5 text-center">
        <Badge tone="warn" icon={CircleCheck}>Already Present</Badge>
        <span className="text-xs text-muted">{formatTime(member.marked_at)}</span>
      </span>
    );
  }
  return (
    <>
      <Button variant="success" icon={CircleCheck} className="px-3" loading={busy("present")} disabled={marking !== null} onClick={() => onMark(member, "present")}>
        Mark Present
      </Button>
      {member.attendance_status !== "absent" && (
        <Button variant="danger-outline" icon={CircleX} className="px-3" loading={busy("absent")} disabled={marking !== null} onClick={() => onMark(member, "absent")}>
          Mark Absent
        </Button>
      )}
    </>
  );
}
