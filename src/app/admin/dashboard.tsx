"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Mars, Scale, SlidersHorizontal, UserPlus, UsersRound, Venus, X } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, LinkButton, Select, StatCard, type SelectOption } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatDate, formatTime, SOURCE_LABEL } from "@/lib/shared";
import { DayChart, type DayRow } from "./day-chart";

type Filters = { event: string; date: string; gender: string; center: string; source: string; officer: string };

const NO_FILTERS: Filters = { event: "all", date: "all", gender: "all", center: "all", source: "all", officer: "all" };


type OfficerRow = { id: string; name: string; present: number };

type Summary = {
  male: number;
  female: number;
  total: number;
  uniqueMembers: number;
  fromExcel: number;
  fromQuickEntry: number;
  /** Everyone in the member list for these filters, present or not. */
  members: { total: number; male: number; female: number; quick: number };
  byDay: DayRow[];
  byOfficer: OfficerRow[];
};

type Report = {
  summary: Summary;
  options: { centers: string[]; dates: string[]; officers: { id: string; name: string }[] };
};

const REFRESH_MS = 10000;

const EVENT_OPTIONS: SelectOption[] = [
  { value: "all", label: "All Days" },
  { value: "1", label: "Gyansatr Day 1" },
  { value: "2", label: "Gyansatr Day 2" },
  { value: "3", label: "Gyansatr Day 3" },
];

const GENDER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

const SOURCE_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "excel_import", label: SOURCE_LABEL.excel_import },
  { value: "quick_entry", label: SOURCE_LABEL.quick_entry },
];


export function Dashboard({ initial, generatedAt }: { initial: Report; generatedAt: string }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [report, setReport] = useState<Report>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date(generatedAt));
  const [error, setError] = useState("");

  const query = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<Report>(`/api/admin/report?${query}`, { signal });
      setReport(data);
      setUpdatedAt(new Date());
      setError("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = setTimeout(() => load(controller.signal), 0);
    // Keeps the counts live while an event is running.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load(controller.signal);
    }, REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      controller.abort();
    };
  }, [load]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const activeFilters = Object.values(filters).filter((v) => v !== "all").length;
  const s = report.summary;
  const noMembers = report.options.centers.length === 0;

  return (
    <>
      <div className="md:hidden">
        <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
      </div>

      <Card aria-label="Filters" className={`${filtersOpen ? "block" : "hidden"} p-4 md:block`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <FilterSelect id="f-event" label="Event" value={filters.event} onChange={(v) => setFilter("event", v)} options={EVENT_OPTIONS} />
          <FilterSelect
            id="f-date"
            label="Date"
            value={filters.date}
            onChange={(v) => setFilter("date", v)}
            options={[{ value: "all", label: "All Dates" }, ...report.options.dates.map((d) => ({ value: d, label: formatDate(d) }))]}
          />
          <FilterSelect id="f-gender" label="Gender" value={filters.gender} onChange={(v) => setFilter("gender", v)} options={GENDER_OPTIONS} />
          <FilterSelect
            id="f-center"
            label="Center"
            value={filters.center}
            onChange={(v) => setFilter("center", v)}
            options={[{ value: "all", label: "All Centers" }, ...report.options.centers.map((c) => ({ value: c, label: c }))]}
          />
          <FilterSelect id="f-source" label="Member source" value={filters.source} onChange={(v) => setFilter("source", v)} options={SOURCE_OPTIONS} />
          <FilterSelect
            id="f-officer"
            label="Marked by"
            value={filters.officer}
            onChange={(v) => setFilter("officer", v)}
            options={[{ value: "all", label: "All Officers" }, ...report.options.officers.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </div>
        <div className="mt-3 flex min-h-9 flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-muted">Updated {formatTime(updatedAt)}</p>
          {activeFilters > 0 && <Button variant="ghost" size="sm" icon={X} onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
        </div>
      </Card>

      {error && (
        <Alert
          tone="danger"
          title={`${error} These numbers are from ${formatTime(updatedAt)}.`}
          action={<Button variant="secondary" size="sm" onClick={() => load()}>Retry</Button>}
        />
      )}

      {noMembers && (
        <Alert
          tone="info"
          title="No members yet."
          action={<LinkButton href="/admin/members" variant="primary" size="sm" icon={FileUp}>Upload Excel</LinkButton>}
        >
          Upload the member Excel so officers can find people when you start an event.
        </Alert>
      )}

      <SummaryCards s={s} />
      <ByOfficer s={s} />
      <DayChart rows={s.byDay} male={s.male} female={s.female} total={s.total} gender={filters.gender} />
    </>
  );
}

/** A filter that's in use stands out, so it's clear why the numbers below are narrowed. */
function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={onChange} options={options} active={value !== "all"} />
    </Field>
  );
}

/** A plain link to the same query string, so the file holds exactly what's on screen. */
/** Each card: the total in the member list first, then how many of them are present for these filters. */
function SummaryCards({ s }: { s: Summary }) {
  const difference = s.male - s.female;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      <StatCard
        tone="hero"
        icon={UsersRound}
        label="Total Users"
        value={s.members.total}
        testId="stat-members"
        secondary={{ label: "Combined attendees", value: s.total, testId: "stat-total" }}
        note={`${s.uniqueMembers} unique members`}
        className="col-span-2 md:col-span-4 lg:col-span-1"
      />
      <StatCard tone="male" icon={Mars} label="Total Male" value={s.members.male} testId="stat-members-male" secondary={{ label: "Present Male", value: s.male, testId: "stat-male" }} />
      <StatCard tone="female" icon={Venus} label="Total Female" value={s.members.female} testId="stat-members-female" secondary={{ label: "Present Female", value: s.female, testId: "stat-female" }} />
      <StatCard
        icon={Scale}
        label="Male minus Female"
        value={difference === 0 ? "0" : `${difference > 0 ? "+" : "−"}${Math.abs(difference)}`}
        note={difference === 0 ? "Equal" : `${Math.abs(difference)} more ${difference > 0 ? "male" : "female"} attendees`}
        testId="stat-difference"
      />
      <StatCard
        tone="warn"
        icon={UserPlus}
        label={`Total ${SOURCE_LABEL.quick_entry}s`}
        value={s.members.quick}
        testId="stat-members-quick"
        secondary={{ label: `Present ${SOURCE_LABEL.quick_entry}s`, value: s.fromQuickEntry, testId: "stat-quick" }}
      />
    </section>
  );
}

/** Each officer's own total, with the entire total underneath. It follows the filters above. */
function ByOfficer({ s }: { s: Summary }) {
  if (s.byOfficer.length === 0) return null;
  return (
    <Card aria-label="Attendance by officer" className="overflow-hidden">
      <CardHeader title="By officer" description="How many people each officer has marked." />
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs text-muted">
            <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold md:pl-5">Officer</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-semibold md:pr-5">Present</th>
          </tr>
        </thead>
        <tbody>
          {s.byOfficer.map((o) => (
            <tr key={o.id} className="border-t border-rule">
              <td className="py-2.5 pr-3 pl-4 font-semibold md:pl-5">{o.name}</td>
              <td className="py-2.5 pr-4 text-right font-bold md:pr-5">{o.present}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-canvas font-bold" data-testid="officer-totals">
            <th scope="row" className="py-2.5 pr-3 pl-4 text-left md:pl-5">All officers</th>
            <td className="py-2.5 pr-4 text-right md:pr-5">{s.total}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
