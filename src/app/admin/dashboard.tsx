"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Download, FileUp, Hash, Inbox, MapPin, Mars, Phone, Scale, SlidersHorizontal, Trash2, UserPlus, UserRoundCheck, UsersRound, Venus, X } from "lucide-react";
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
  Skeleton,
  SourceBadge,
  StatCard,
  TextInput,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatDate, formatDateTime, formatTime, type Gender, type MemberSource } from "@/lib/shared";

type Filters = { event: string; date: string; gender: string; center: string; source: string };

const NO_FILTERS: Filters = { event: "all", date: "all", gender: "all", center: "all", source: "all" };

type DayRow = { eventDay: number; eventName: string; date: string; male: number; female: number; total: number };

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
};

type AttendanceRecord = {
  id: number;
  event_name: string;
  marked_at: string;
  marked_by: string;
  global_member_id: string | null;
  name: string;
  mobile: string;
  gender: Gender;
  center: string;
  created_source: MemberSource;
};

type Report = {
  summary: Summary;
  records: AttendanceRecord[];
  options: { centers: string[]; dates: string[] };
  page: number;
  pageSize: number;
};

const REFRESH_MS = 10000;

const shortEvent = (r: AttendanceRecord) => r.event_name.replace("Gyansatr ", "");

export function Dashboard() {
  const toast = useToast();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<AttendanceRecord | null>(null);

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
  const s = report?.summary;
  const noMembers = report?.options.centers.length === 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
        <ExportLink query={query} />
      </div>

      <Card aria-label="Filters" className={`${filtersOpen ? "block" : "hidden"} p-4 md:block`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Event" htmlFor="f-event">
            <Select id="f-event" value={filters.event} onChange={(e) => setFilter("event", e.target.value)}>
              <option value="all">All Days</option>
              <option value="1">Gyansatr Day 1</option>
              <option value="2">Gyansatr Day 2</option>
              <option value="3">Gyansatr Day 3</option>
            </Select>
          </Field>
          <Field label="Date" htmlFor="f-date">
            <Select id="f-date" value={filters.date} onChange={(e) => setFilter("date", e.target.value)}>
              <option value="all">All Dates</option>
              {report?.options.dates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}
            </Select>
          </Field>
          <Field label="Gender" htmlFor="f-gender">
            <Select id="f-gender" value={filters.gender} onChange={(e) => setFilter("gender", e.target.value)}>
              <option value="all">All</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
          </Field>
          <Field label="Center" htmlFor="f-center">
            <Select id="f-center" value={filters.center} onChange={(e) => setFilter("center", e.target.value)}>
              <option value="all">All Centers</option>
              {report?.options.centers.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Member source" htmlFor="f-source">
            <Select id="f-source" value={filters.source} onChange={(e) => setFilter("source", e.target.value)}>
              <option value="all">All</option>
              <option value="excel_import">Excel Import</option>
              <option value="quick_entry">Quick Entry</option>
            </Select>
          </Field>
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
          title={`${error}${updatedAt ? ` These numbers are from ${formatTime(updatedAt)}.` : ""}`}
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

      {!s && !error && <SummarySkeleton />}

      {s && (
        <>
          <SummaryCards s={s} />
          <DayWise s={s} gender={filters.gender} />

          <Card aria-label="Attendance records" className="overflow-hidden">
            <CardHeader
              title="Attendance report"
              description={
                <>
                  {s.total} records: {s.fromExcel} Excel Import, {s.fromQuickEntry} Quick Entry
                  {updatedAt ? `. Updated ${formatTime(updatedAt)}` : ""}
                </>
              }
              actions={<div className="hidden md:block"><ExportLink query={query} /></div>}
            />
            <RecordsTable records={report.records} onCancel={setCancelling} />
            <Pagination page={page} pageSize={report.pageSize} total={s.total} onPage={setPage} />
          </Card>
        </>
      )}

      <Modal open={cancelling !== null} onClose={() => setCancelling(null)} title="Remove attendance">
        {cancelling && (
          <CancelForm
            key={cancelling.id}
            record={cancelling}
            onClose={() => setCancelling(null)}
            onDone={() => {
              setCancelling(null);
              toast("success", "Attendance removed.");
              load();
            }}
          />
        )}
      </Modal>
    </>
  );
}

/** A plain link to the same query string, so the file holds exactly what's on screen. */
function ExportLink({ query }: { query: string }) {
  return <LinkButton native href={`/api/admin/report/export?${query}`} icon={Download}>Export to Excel</LinkButton>;
}

function SummarySkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className={`h-28 rounded-card ${i === 0 ? "col-span-2 md:col-span-4 lg:col-span-1" : ""}`} />
      ))}
    </div>
  );
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

function RecordsTable({ records, onCancel }: { records: AttendanceRecord[]; onCancel: (record: AttendanceRecord) => void }) {
  if (records.length === 0) {
    return <EmptyState icon={UserRoundCheck} titleAs="p" title="No attendance records for these filters" description="They appear here as officers mark people present." />;
  }

  const remove = (r: AttendanceRecord) => (
    <Button variant="ghost-danger" size="sm" icon={Trash2} onClick={() => onCancel(r)}>Remove</Button>
  );

  const columns: Column<AttendanceRecord>[] = [
    { key: "name", header: "Name", cell: (r) => <PersonCell name={r.name} gender={r.gender} /> },
    { key: "id", header: "Member ID", nowrap: true, cell: (r) => r.global_member_id ?? <span className="text-muted">—</span> },
    { key: "mobile", header: "Mobile", nowrap: true, cell: (r) => <span className="text-muted">{r.mobile}</span> },
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
    { key: "by", header: "Marked by", nowrap: true, cell: (r) => <span className="text-muted">{r.marked_by}</span> },
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
                { icon: Phone, label: r.mobile },
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

function CancelForm({ record, onClose, onDone }: { record: AttendanceRecord; onClose: () => void; onDone: () => void }) {
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
        Remove <strong className="font-semibold">{record.name}</strong> from <strong className="font-semibold">{record.event_name}</strong>? If the event is still active, an officer can mark them again.
      </p>
      <Field label="Reason" htmlFor="cancel-reason">
        <TextInput id="cancel-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>{busy ? "Removing…" : "Remove Attendance"}</Button>
      </ModalActions>
    </div>
  );
}
