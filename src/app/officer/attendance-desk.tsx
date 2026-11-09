"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, CircleX, Hash, ListChecks, Lock, MapPin, Phone, Search, UserCheck, UserPlus, UsersRound, UserX } from "lucide-react";
import { EventDayTabs } from "@/components/event-days";
import { Alert, AttendanceBadge, Badge, Button, Card, CardHeader, EmptyState, Field, GenderBadge, MetaList, Pagination, PersonRow, SearchInput, Skeleton, Spinner, StatCard, useToast } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { formatTime, STATUS_LABEL, type AttendanceStatus, type EventSession, type Gender } from "@/lib/shared";
import { OfficerHistory, type HistoryPage } from "./officer-history";
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

type DayCount = { present: number; absent: number; myPresent: number; myAbsent: number };

type UnmarkedPage = { members: SearchResult[]; total: number; pageSize: number };

export type DeskData = {
  events: EventSession[];
  counts: Record<string, DayCount>;
  day: number;
  history: HistoryPage;
  unmarked: UnmarkedPage;
};

const POLL_MS = 5000;
const NO_COUNT: DayCount = { present: 0, absent: 0, myPresent: 0, myAbsent: 0 };

/** The marking screen, shared by officers and Admin. The server keeps the rules for both. */
export function AttendanceDesk({ initial }: { initial: DeskData }) {
  const [events, setEvents] = useState(initial.events);
  const [counts, setCounts] = useState(initial.counts);
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
    <>
      <EventDayTabs events={events} selectedDay={selectedDay} onSelect={setChosenDay} />

      {selected.status === "active" ? (
        <MarkingPanel
          key={`marking-${selectedDay}`}
          event={selected}
          count={count}
          initialUnmarked={selectedDay === initial.day ? initial.unmarked : null}
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
              </>
            }
            action={activeDay && <Button onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>}
          />
        </Card>
      )}

      <OfficerTotals event={selected} count={count} />
      <OfficerHistory
        key={`history-${selectedDay}`}
        event={selected}
        version={`${count.present}-${count.absent}`}
        initial={selectedDay === initial.day ? initial.history : null}
      />
    </>
  );
}

/** What this officer has done next to what everyone has, for the day chosen above. */
function OfficerTotals({ event, count }: { event: EventSession; count: DayCount }) {
  return (
    <section aria-label={`Totals for ${event.name}`} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard tone="hero" icon={UserCheck} label="My present" value={count.myPresent} testId="stat-my-present" />
      <StatCard tone="danger" icon={UserX} label="My absent" value={count.myAbsent} testId="stat-my-absent" />
      <StatCard icon={UsersRound} label="Total present" value={count.present} note="All officers" testId="stat-all-present" />
      <StatCard icon={UsersRound} label="Total absent" value={count.absent} note="All officers" testId="stat-all-absent" />
    </section>
  );
}

function MarkingHeading({ event, count }: { event: EventSession; count: DayCount }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-brand px-4 py-2.5 text-white">
      <h1 className="text-xl leading-tight font-bold">Marking {event.name}</h1>
      <p className="flex shrink-0 items-baseline gap-1.5" data-testid="present-count">
        <span className="text-3xl leading-none font-bold">{count.myPresent}</span>
        <span className="text-sm text-white/85">by me · {count.present} total</span>
      </p>
    </div>
  );
}

function MarkingPanel({
  event,
  count,
  initialUnmarked,
  onChanged,
}: {
  event: EventSession;
  count: DayCount;
  initialUnmarked: UnmarkedPage | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [marking, setMarking] = useState<{ id: number; status: AttendanceStatus } | null>(null);
  const [prefill, setPrefill] = useState<QuickEntryPrefill | null>(null);
  const [latest, setLatest] = useState<Marked | null>(null);
  const [unmarked, setUnmarked] = useState(initialUnmarked);
  const [unmarkedPage, setUnmarkedPage] = useState(1);
  // Someone just marked leaves the list at once, before the refreshed list arrives.
  const [justMarked, setJustMarked] = useState<ReadonlySet<number>>(new Set());
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

  const version = `${count.present}-${count.absent}`;

  useEffect(() => {
    const controller = new AbortController();
    api<UnmarkedPage>(`/api/officer/unmarked?day=${event.event_day}&page=${unmarkedPage}`, { signal: controller.signal })
      .then(setUnmarked)
      .catch(() => {}); // the list on screen stays, and the next change tries again
    return () => controller.abort();
  }, [event.event_day, unmarkedPage, version]);

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setResultsFor("");
    setSearchError("");
    inputRef.current?.focus();
  };

  const remember = (status: AttendanceStatus, label: string, name: string, at: string) => {
    nextKey.current += 1;
    setLatest({ key: nextKey.current, status, label, name, at });
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
        setJustMarked((ids) => new Set(ids).add(member.id));
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
              <li key={member.id}><MemberRow member={member} marking={marking} onMark={mark} /></li>
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

      <Button variant={noMatches ? "primary" : "secondary"} icon={UserPlus} size="lg" className="w-full" onClick={openQuickEntry}>
        Quick Entry: add new member
      </Button>

      {!trimmed && (
        <Card aria-label="Not marked yet" className="overflow-hidden">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><ListChecks aria-hidden size={16} className="text-muted" />Not marked yet{unmarked ? ` (${unmarked.total})` : ""}</span>}
            description="Tap Mark Present or Mark Absent next to a person, or search above."
          />
          {!unmarked && (
            <div aria-hidden className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
            </div>
          )}
          {unmarked && unmarked.total === 0 && (
            <EmptyState icon={ListChecks} titleAs="p" title="Everyone has been marked" description="If someone isn't on the member list, add them with Quick Entry." />
          )}
          {unmarked && unmarked.total > 0 && (
            <ul className="divide-y divide-rule">
              {unmarked.members.filter((m) => !justMarked.has(m.id)).map((member) => (
                <li key={member.id}><MemberRow member={member} marking={marking} onMark={mark} /></li>
              ))}
            </ul>
          )}
          {unmarked && <Pagination page={unmarkedPage} pageSize={unmarked.pageSize} total={unmarked.total} onPage={setUnmarkedPage} />}
        </Card>
      )}

    </>
  );
}

function MemberRow({
  member,
  marking,
  onMark,
}: {
  member: SearchResult;
  marking: { id: number; status: AttendanceStatus } | null;
  onMark: (member: SearchResult, status: AttendanceStatus) => void;
}) {
  return (
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
      actions={<RowActions member={member} marking={marking} onMark={onMark} />}
    />
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
