"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, Hash, History, ListChecks, Lock, MapPin, Phone, Search, UserCheck, UserPlus, UsersRound } from "lucide-react";
import { EventDayTabs } from "@/components/event-days";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, GenderBadge, MetaList, Pagination, PersonRow, SearchInput, Select, Skeleton, Spinner, StatCard, useToast } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { formatTime, STATUS_LABEL, type EventSession, type Gender } from "@/lib/shared";
import { OfficerHistory, type HistoryPage } from "./officer-history";
import { QuickEntryPanel, type QuickEntryPrefill } from "./quick-entry-panel";

type SearchResult = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string | null;
  gender: Gender;
  center: string;
  present_at: string | null;
  marked_by: string | null;
};

type MarkResponse = { status: "marked" | "already_present"; memberName: string; markedAt: string; markedBy: string };

type Marked = { key: number; label: string; name: string; at: string };

type DayCount = { present: number; myPresent: number };

type UnmarkedPage = { members: SearchResult[]; total: number; pageSize: number; centers: string[] };

export type DeskData = {
  events: EventSession[];
  counts: Record<string, DayCount>;
  day: number;
  history: HistoryPage;
  unmarked: UnmarkedPage;
};

const POLL_MS = 5000;
const NO_COUNT: DayCount = { present: 0, myPresent: 0 };

/** The marking screen, shared by officers and Admin. The server keeps the rules for both. */
export function AttendanceDesk({ initial, officerGender = null }: { initial: DeskData; officerGender?: Gender | null }) {
  const [events, setEvents] = useState(initial.events);
  const [counts, setCounts] = useState(initial.counts);
  // null means "follow whichever event is active".
  const [chosenDay, setChosenDay] = useState<number | null>(null);

  const activeDay = events.find((e) => e.status === "active")?.event_day ?? null;
  const selectedDay = chosenDay ?? activeDay ?? 1;
  const selected = events.find((e) => e.event_day === selectedDay)!;
  const count = counts[selectedDay] ?? NO_COUNT;

  // Phones and tablets show one side at a time. Large screens show both, so this does nothing there.
  const [view, setView] = useState<"mark" | "history">("mark");

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

      <div className="grid gap-5 pb-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:pb-0">
        <div className={`min-w-0 flex-col gap-5 lg:flex ${view === "mark" ? "flex" : "hidden"}`}>
          {selected.status === "active" ? (
            <MarkingPanel
              key={`marking-${selectedDay}`}
              event={selected}
              count={count}
              officerGender={officerGender}
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
                  selected.status === "ended"
                    ? "This event has ended, so attendance can no longer be marked."
                    : "Attendance can be marked after Admin starts this event."
                }
                action={activeDay && <Button onClick={() => setChosenDay(activeDay)}>Go to Day {activeDay}, which is active</Button>}
              />
            </Card>
          )}
        </div>

        {/* Stays in view while the list on the left scrolls, with the history scrolling inside it. */}
        <div className={`min-w-0 flex-col gap-5 lg:sticky lg:top-[5rem] lg:flex lg:max-h-[calc(100dvh-6rem)] ${view === "history" ? "flex" : "hidden"}`}>
          <Totals event={selected} count={count} />
          <OfficerHistory
            key={`history-${selectedDay}`}
            event={selected}
            version={String(count.present)}
            initial={selectedDay === initial.day ? initial.history : null}
            isAdmin={officerGender === null}
            onRemoved={() => refreshEvents().catch(() => {})}
          />
        </div>
      </div>

      <nav aria-label="Marking view" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgb(15_47_79/0.08)] lg:hidden">
        {([["mark", "Mark", UserCheck], ["history", "History", History]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-current={view === key ? "page" : undefined}
            onClick={() => setView(key)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors duration-150 ${view === key ? "text-brand" : "text-muted"}`}
          >
            <Icon aria-hidden size={20} />
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

/** This account's part next to the whole, for the day chosen above. */
function Totals({ event, count }: { event: EventSession; count: DayCount }) {
  return (
    <section aria-label={`Totals for ${event.name}`} className="grid shrink-0 grid-cols-2 gap-3">
      <StatCard tone="hero" icon={UserCheck} label="My present" value={count.myPresent} testId="stat-my-present" />
      <StatCard icon={UsersRound} label="Total present" value={count.present} note="All officers" testId="stat-all-present" />
    </section>
  );
}

function MarkingHeading({ event, count }: { event: EventSession; count: DayCount }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-brand px-4 py-2.5 text-white">
      {/* The full name stays for screen readers, and one short line on phones. */}
      <h1 className="text-lg leading-tight font-bold whitespace-nowrap sm:text-xl">
        Marking <span className="max-sm:sr-only">Gyansatr </span>Day {event.event_day}
      </h1>
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
  officerGender,
  initialUnmarked,
  onChanged,
}: {
  event: EventSession;
  count: DayCount;
  officerGender: Gender | null;
  initialUnmarked: UnmarkedPage | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<QuickEntryPrefill | null>(null);
  const [latest, setLatest] = useState<Marked | null>(null);
  const [unmarked, setUnmarked] = useState(initialUnmarked);
  const [unmarkedPage, setUnmarkedPage] = useState(1);
  const [area, setArea] = useState("all");
  // Someone just marked leaves the list at once, before the refreshed list arrives.
  const [justMarked, setJustMarked] = useState<ReadonlySet<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const trimmed = query.trim();
  // Results belong to both what was typed and the area, so changing either makes them out of date.
  const searchKey = `${area}|${trimmed}`;
  const showResults = trimmed !== "" && resultsFor === searchKey;
  const searching = trimmed !== "" && resultsFor !== searchKey && !searchError;
  const noMatches = showResults && results.length === 0;
  const onlyOne = showResults && results.length === 1 && !results[0].present_at;

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    // A short pause so each keystroke doesn't send its own request, and an abort so slow responses can't overwrite newer ones.
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ results: SearchResult[] }>(
          `/api/officer/search?day=${event.event_day}&q=${encodeURIComponent(trimmed)}&center=${encodeURIComponent(area)}`,
          { signal: controller.signal },
        );
        setResults(data.results);
        setResultsFor(searchKey);
        setSearchError("");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSearchError((err as Error).message);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searchKey, area, event.event_day]);

  const version = String(count.present);
  // Officers find people by search only, so the list stays off their screen. Admin keeps it.
  const showList = officerGender === null;
  // Officers still need the area names, which come with the first page, so theirs is fetched once.
  const listQuery = showList ? `page=${unmarkedPage}&center=${encodeURIComponent(area)}` : "page=1&center=all";
  const listVersion = showList ? version : "";

  useEffect(() => {
    const controller = new AbortController();
    api<UnmarkedPage>(`/api/officer/unmarked?day=${event.event_day}&${listQuery}`, { signal: controller.signal })
      .then(setUnmarked)
      .catch(() => {}); // the list on screen stays, and the next change tries again
    return () => controller.abort();
  }, [event.event_day, listQuery, listVersion]);

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setResultsFor("");
    setSearchError("");
    inputRef.current?.focus();
  };

  const remember = (label: string, name: string, at: string) => {
    nextKey.current += 1;
    setLatest({ key: nextKey.current, label, name, at });
  };

  async function mark(member: SearchResult) {
    if (markingId !== null) return;
    setMarkingId(member.id);
    try {
      const res = await api<MarkResponse>("/api/officer/attendance", {
        json: { memberId: member.id, eventDay: event.event_day },
      });
      setJustMarked((ids) => new Set(ids).add(member.id));
      if (res.status === "marked") {
        remember("Present", res.memberName, res.markedAt);
        onChanged();
        clearSearch();
      } else {
        // Another device got there first, which is expected with several devices on one login.
        toast("warning", `Already Present: ${res.memberName} (${formatTime(res.markedAt)})`);
        setResults((rows) => rows.map((r) => (r.id === member.id ? { ...r, present_at: res.markedAt, marked_by: res.markedBy } : r)));
        onChanged();
      }
    } catch (err) {
      toast("error", (err as Error).message);
      if (err instanceof ClientApiError && err.code === "event_not_active") onChanged();
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
          <MarkingHeading event={event} count={count} />
        </Card>
        <QuickEntryPanel
          prefill={prefill}
          event={event}
          officerGender={officerGender}
          defaultCenter={area === "all" ? "" : area}
          onCancel={() => setPrefill(null)}
          onFindExisting={(name) => {
            setPrefill(null);
            setArea("all");
            setQuery(name);
          }}
          onSaved={(name, at) => {
            setPrefill(null);
            remember("Added and marked present", name, at);
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
              placeholder="206383, Ghanshyam Pande, 9876543210"
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
        <Alert
          key={latest.key}
          tone="ok"
          role="status"
          className="rise-in"
          title={`${latest.label}: ${latest.name}`}
          action={<span className="text-sm font-semibold text-ok">{formatTime(latest.at)}</span>}
        />
      )}

      {/* Below the confirmation, so a phone's keyboard can't push that out of view. */}
      <section aria-label="Area and Quick Entry" className="flex flex-col gap-3">
        <Field label="Area" htmlFor="area-filter" labelOnlyForReaders>
          <Select
            id="area-filter"
            value={area}
            active={area !== "all"}
            options={[{ value: "all", label: "All Areas" }, ...(unmarked?.centers ?? []).map((c) => ({ value: c, label: c }))]}
            onChange={(value) => {
              setArea(value);
              setUnmarkedPage(1);
            }}
          />
        </Field>
        {/* Full width and filled, so it's easy to find for someone who isn't on the list. */}
        <Button size="lg" icon={UserPlus} className="w-full" onClick={openQuickEntry}>
          Quick Entry: add new member
        </Button>
      </section>

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
              <li key={member.id}><MemberRow member={member} busy={markingId === member.id} disabled={markingId !== null} showGender={officerGender === null} onMark={mark} /></li>
            ))}
          </ul>
        </Card>
      )}

      {noMatches && (
        <Card>
          <EmptyState
            icon={Search}
            titleAs="p"
            title={`No member matches “${trimmed}”${area === "all" ? "" : ` in ${area}`}`}
            description={area === "all" ? "Check the spelling or try the mobile number. If they are new, add them with Quick Entry." : "Try All Areas, or check the spelling. If they are new, add them with Quick Entry."}
          />
        </Card>
      )}

      {showList && !trimmed && (
        <Card aria-label="Not marked yet" className="overflow-hidden">
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><ListChecks aria-hidden size={16} className="text-muted" />Not marked yet{unmarked ? ` (${unmarked.total})` : ""}</span>}
            description={<span className="max-sm:hidden">Tap Mark next to a person to mark them present.</span>}
          />
          {!unmarked && (
            <div aria-hidden className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
            </div>
          )}
          {unmarked && unmarked.total === 0 && (
            <EmptyState icon={ListChecks} titleAs="p" title={area === "all" ? "Everyone has been marked" : `Everyone in ${area} has been marked`} description="If someone isn't on the member list, add them with Quick Entry." />
          )}
          {unmarked && unmarked.total > 0 && (
            <ul className="divide-y divide-rule">
              {unmarked.members.filter((m) => !justMarked.has(m.id)).map((member) => (
                <li key={member.id}><MemberRow member={member} busy={markingId === member.id} disabled={markingId !== null} showGender={officerGender === null} onMark={mark} /></li>
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
  busy,
  disabled,
  showGender,
  onMark,
}: {
  member: SearchResult;
  busy: boolean;
  disabled: boolean;
  showGender: boolean;
  onMark: (member: SearchResult) => void;
}) {
  return (
    <PersonRow
      name={member.name}
      gender={member.gender}
      hideAvatarOnPhone
      nameBadge={showGender && <GenderBadge gender={member.gender} />}
      meta={
        <MetaList
          items={[
            member.global_member_id ? { icon: Hash, label: member.global_member_id, strong: true } : null,
            member.mobile ? { icon: Phone, label: member.mobile } : null,
            { icon: MapPin, label: member.center },
          ]}
        />
      }
      actions={
        member.present_at ? (
          // Present is final here: only Admin can remove it.
          <span className="flex flex-col items-center gap-0.5 text-center">
            <Badge tone="warn" icon={CircleCheck}>Already Present</Badge>
            <span className="text-xs text-muted">{formatTime(member.present_at)}</span>
          </span>
        ) : (
          <Button variant="success" size="pill" icon={CircleCheck} aria-label="Mark Present" title="Mark Present" loading={busy} disabled={disabled} onClick={() => onMark(member)}>
            Mark
          </Button>
        )
      }
    />
  );
}
