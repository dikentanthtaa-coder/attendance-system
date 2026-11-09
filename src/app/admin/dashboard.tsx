"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Download, FileUp, Hash, History, Inbox, MapPin, Mars, Phone, Scale, SlidersHorizontal, Trash2, UserPlus, UserRoundCheck, UsersRound, Venus, X } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  GenderBadge,
  LinkButton,
  MetaList,
  Modal,
  ModalActions,
  Pagination,
  PersonCell,
  PersonRow,
  Select,
  SourceBadge,
  StatCard,
  TextInput,
  useToast,
  type Column,
  type SelectOption,
} from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatDate, formatDateTime, formatTime, SOURCE_LABEL, type Gender, type MemberSource } from "@/lib/shared";

type Filters = { event: string; date: string; gender: string; center: string; source: string; officer: string };

const NO_FILTERS: Filters = { event: "all", date: "all", gender: "all", center: "all", source: "all", officer: "all" };

type DayRow = { eventDay: number; eventName: string; date: string; male: number; female: number; total: number };

type OfficerRow = { id: string; name: string; present: number };

type Summary = {
  male: number;
  female: number;
  total: number;
  uniqueMembers: number;
  fromExcel: number;
  fromQuickEntry: number;
  quickEntryToday: number;
  quickEntryInSelection: number;
  byDay: DayRow[];
  byOfficer: OfficerRow[];
};

type AttendanceRecord = {
  id: number;
  event_name: string;
  marked_at: string;
  marked_by: string;
  global_member_id: string | null;
  name: string;
  mobile: string | null;
  gender: Gender;
  center: string;
  created_source: MemberSource;
};

type Report = {
  summary: Summary;
  records: AttendanceRecord[];
  options: { centers: string[]; dates: string[]; officers: { id: string; name: string }[] };
  page: number;
  pageSize: number;
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

const shortEvent = (r: AttendanceRecord) => r.event_name.replace("Gyansatr ", "");

export function Dashboard({ initial, generatedAt }: { initial: Report; generatedAt: string }) {
  const toast = useToast();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date(generatedAt));
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<AttendanceRecord | null>(null);

  const query = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<Report>(`/api/admin/report?${query}&page=${page}`, { signal });
      setReport(data);
      setUpdatedAt(new Date());
      setError("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [query, page]);

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

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const activeFilters = Object.values(filters).filter((v) => v !== "all").length;
  const s = report.summary;
  const noMembers = report.options.centers.length === 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
        <ExportLink query={query} />
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
        {activeFilters > 0 && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Button>
          </div>
        )}
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
      <ByOfficer
        s={s}
        onView={(id) => {
          setFilter("officer", id);
          document.getElementById("attendance-records")?.scrollIntoView({ behavior: "smooth" });
        }}
      />
      <DayWise s={s} gender={filters.gender} />

      <Card id="attendance-records" aria-label="Attendance records" className="scroll-mt-20 overflow-hidden">
        <CardHeader
          title="Attendance report"
          description={
            <>
              {s.total} records: {s.fromExcel} {SOURCE_LABEL.excel_import}, {s.fromQuickEntry} {SOURCE_LABEL.quick_entry}. Updated {formatTime(updatedAt)}
            </>
          }
          actions={<div className="hidden md:block"><ExportLink query={query} /></div>}
        />
        <RecordsTable records={report.records} onRemove={setRemoving} />
        <Pagination page={page} pageSize={report.pageSize} total={s.total} onPage={setPage} />
      </Card>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove attendance">
        {removing && (
          <RemoveForm
            key={removing.id}
            record={removing}
            onClose={() => setRemoving(null)}
            onDone={() => {
              setRemoving(null);
              toast("success", "Attendance removed.");
              load();
            }}
          />
        )}
      </Modal>
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
function ExportLink({ query }: { query: string }) {
  return <LinkButton native href={`/api/admin/report/export?${query}`} icon={Download}>Export to Excel</LinkButton>;
}

function SummaryCards({ s }: { s: Summary }) {
  const difference = s.male - s.female;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      <StatCard tone="hero" icon={UsersRound} label="Combined attendees" value={s.total} note={`${s.uniqueMembers} unique members`} testId="stat-total" className="col-span-2 md:col-span-4 lg:col-span-1" />
      <StatCard tone="male" icon={Mars} label="Male" value={s.male} testId="stat-male" />
      <StatCard tone="female" icon={Venus} label="Female" value={s.female} testId="stat-female" />
      <StatCard
        icon={Scale}
        label="Male minus Female"
        value={difference === 0 ? "0" : `${difference > 0 ? "+" : "−"}${Math.abs(difference)}`}
        note={difference === 0 ? "Equal" : `${Math.abs(difference)} more ${difference > 0 ? "male" : "female"} attendees`}
        testId="stat-difference"
      />
      <StatCard tone="warn" icon={UserPlus} label="Quick Entry today" value={s.quickEntryToday} note={`${s.quickEntryInSelection} in these filters`} testId="stat-quick" />
    </section>
  );
}

/** Each officer's own total, with the entire total underneath. It follows the filters above. */
function ByOfficer({ s, onView }: { s: Summary; onView: (id: string) => void }) {
  if (s.byOfficer.length === 0) return null;
  return (
    <Card aria-label="Attendance by officer" className="overflow-hidden">
      <CardHeader title="By officer" description="How many people each officer has marked." />
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs text-muted">
            <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold md:pl-5">Officer</th>
            <th scope="col" className="py-2.5 pr-3 text-right font-semibold">Present</th>
            <th scope="col" aria-label="Actions" className="pr-2 md:pr-3" />
          </tr>
        </thead>
        <tbody>
          {s.byOfficer.map((o) => (
            <tr key={o.id} className="border-t border-rule">
              <td className="py-1.5 pr-3 pl-4 font-semibold md:pl-5">{o.name}</td>
              <td className="py-1.5 pr-3 text-right font-bold">{o.present}</td>
              <td className="py-1 pr-2 text-right md:pr-3">
                <Button variant="ghost" size="sm" icon={History} aria-label={`View history for ${o.name}`} onClick={() => onView(o.id)}>
                  <span className="hidden sm:inline">History</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-canvas font-bold" data-testid="officer-totals">
            <th scope="row" className="py-2.5 pr-3 pl-4 text-left md:pl-5">All officers</th>
            <td className="py-2.5 pr-3 text-right">{s.total}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function Legend() {
  return (
    <ul className="flex gap-3 text-sm text-muted">
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-male" />Male</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-female" />Female</li>
    </ul>
  );
}

function DayWise({ s, gender }: { s: Summary; gender: string }) {
  const rows = s.byDay;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const showMale = gender !== "Female";
  const showFemale = gender !== "Male";
  const both = showMale && showFemale;
  const malePercent = s.total > 0 ? Math.round((s.male / s.total) * 100) : 0;
  return (
    <Card aria-label="Event day-wise attendance" className="overflow-hidden">
      <CardHeader title="By event day and date" actions={both && <Legend />} />
      {rows.length === 0 ? (
        <EmptyState icon={Inbox} titleAs="p" title="No attendance yet" description="Numbers appear here as officers mark people present." />
      ) : (
        <>
          {both && s.total > 0 && (
            <div className="border-b border-rule px-4 py-3 md:px-5">
              <div className="flex gap-0.5" role="img" aria-label={`${malePercent}% male, ${100 - malePercent}% female`}>
                {s.male > 0 && <div className="h-3 rounded-[4px] bg-male" style={{ flexGrow: s.male }} />}
                {s.female > 0 && <div className="h-3 rounded-[4px] bg-female" style={{ flexGrow: s.female }} />}
              </div>
              <div className="mt-1 flex justify-between text-sm text-muted">
                <span>Male {malePercent}%</span>
                <span>Female {100 - malePercent}%</span>
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs text-muted">
                <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold md:pl-5">Event</th>
                <th scope="col" className="py-2.5 pr-3 text-right font-semibold">Male</th>
                <th scope="col" className="py-2.5 pr-3 text-right font-semibold">Female</th>
                <th scope="col" className="py-2.5 pr-4 text-right font-semibold md:pr-6">Total</th>
                <th scope="col" aria-label="Chart" className="hidden w-1/2 py-2.5 pr-5 md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.eventDay}-${r.date}`} className="border-t border-rule">
                  <td className="py-2.5 pr-3 pl-4 md:pl-5">
                    <span className="block font-semibold whitespace-nowrap">{r.eventName}</span>
                    <span className="block text-xs whitespace-nowrap text-muted">{formatDate(r.date)}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right">{r.male}</td>
                  <td className="py-2.5 pr-3 text-right">{r.female}</td>
                  <td className="py-2.5 pr-4 text-right font-bold md:pr-6">{r.total}</td>
                  <td className="hidden py-2.5 pr-5 md:table-cell">
                    <div className="flex gap-0.5" style={{ width: `${(r.total / max) * 100}%` }}>
                      {showMale && r.male > 0 && <BarPart row={r} value={r.male} label="male" className="bg-male" />}
                      {showFemale && r.female > 0 && <BarPart row={r} value={r.female} label="female" className="bg-female" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function BarPart({ row, value, label, className }: { row: DayRow; value: number; label: string; className: string }) {
  return (
    <div className="group relative py-1" style={{ flexGrow: value, flexBasis: 0 }}>
      <div className={`h-3 rounded-[4px] ${className}`} />
      <div role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 hidden rounded-control bg-ink px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg group-hover:block">
        {row.eventName}: {value} {label} of {row.total}
      </div>
    </div>
  );
}

function RecordsTable({ records, onRemove }: { records: AttendanceRecord[]; onRemove: (record: AttendanceRecord) => void }) {
  if (records.length === 0) {
    return <EmptyState icon={UserRoundCheck} titleAs="p" title="No attendance records for these filters" description="They appear here as officers mark people present." />;
  }

  const remove = (r: AttendanceRecord) => (
    <Button variant="ghost-danger" size="sm" icon={Trash2} onClick={() => onRemove(r)}>Remove</Button>
  );

  const columns: Column<AttendanceRecord>[] = [
    // ID and mobile share a column, so the whole table fits on a laptop without scrolling sideways.
    { key: "name", header: "Name", cell: (r) => <PersonCell name={r.name} gender={r.gender} detail={[r.global_member_id, r.mobile].filter(Boolean).join(" · ")} /> },
    { key: "gender", header: "Gender", cell: (r) => <GenderBadge gender={r.gender} /> },
    { key: "center", header: "Center", cell: (r) => <span className="text-muted">{r.center}</span> },
    {
      key: "event",
      header: "Event and time",
      nowrap: true,
      cell: (r) => (
        <>
          <span className="block font-medium">{shortEvent(r)}</span>
          <span className="block text-xs text-muted">{formatDateTime(r.marked_at)}</span>
        </>
      ),
    },
    { key: "by", header: "Marked by", cell: (r) => <span className="text-muted">{r.marked_by}</span> },
    { key: "source", header: "Source", cell: (r) => <SourceBadge source={r.created_source} /> },
    { key: "actions", header: "Actions", hideHeader: true, align: "right", cell: remove },
  ];

  return (
    <DataTable
      rows={records}
      columns={columns}
      rowKey={(r) => r.id}
      mobileRow={(r) => (
        <PersonRow
          name={r.name}
          gender={r.gender}
          meta={
            <MetaList
              items={[
                r.global_member_id ? { icon: Hash, label: r.global_member_id, strong: true } : null,
                r.mobile ? { icon: Phone, label: r.mobile } : null,
                { icon: MapPin, label: r.center },
                { icon: Clock, label: `${shortEvent(r)}, ${formatDateTime(r.marked_at)}` },
                { icon: UserRoundCheck, label: r.marked_by },
              ]}
            />
          }
          footer={
            <>
              <GenderBadge gender={r.gender} />
              <SourceBadge source={r.created_source} />
              <span className="ml-auto">{remove(r)}</span>
            </>
          }
        />
      )}
    />
  );
}

/** Only Admin reaches this, and every removal needs a reason. Officers can't undo attendance. */
function RemoveForm({ record, onClose, onDone }: { record: AttendanceRecord; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/attendance/${record.id}/cancel`, { json: { reason } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        Remove <strong className="font-semibold">{record.name}</strong> from <strong className="font-semibold">{record.event_name}</strong>? If the event is still active, they can be marked again.
      </p>
      <Field label="Reason" htmlFor="remove-reason">
        <TextInput id="remove-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>{busy ? "Removing…" : "Remove Attendance"}</Button>
      </ModalActions>
    </div>
  );
}
