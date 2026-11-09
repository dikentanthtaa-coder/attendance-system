"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/components/toast";
import { api, Button, ErrorNote, Field, inputClass, Modal, Pagination, RowAction, selectClass } from "@/components/ui";
import { formatDate, formatDateTime, formatTime, SOURCE_LABEL, type Gender, type MemberSource } from "@/lib/shared";

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
      <div className="flex flex-col gap-3 pt-3">
        <div className="flex items-center justify-between gap-3 md:hidden">
          <Button variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            <SlidersHorizontal aria-hidden size={16} />
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </Button>
          <ExportLink query={query} />
        </div>
        <section aria-label="Filters" className={`${filtersOpen ? "grid" : "hidden"} relative grid-cols-2 gap-3 md:grid md:grid-cols-5`}>
          <Field label="Event" htmlFor="f-event">
            <select id="f-event" className={selectClass} value={filters.event} onChange={(e) => setFilter("event", e.target.value)}>
              <option value="all">All Days</option>
              <option value="1">Gyansatr Day 1</option>
              <option value="2">Gyansatr Day 2</option>
              <option value="3">Gyansatr Day 3</option>
            </select>
          </Field>
          <Field label="Date" htmlFor="f-date">
            <select id="f-date" className={selectClass} value={filters.date} onChange={(e) => setFilter("date", e.target.value)}>
              <option value="all">All Dates</option>
              {report?.options.dates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}
            </select>
          </Field>
          <Field label="Gender" htmlFor="f-gender">
            <select id="f-gender" className={selectClass} value={filters.gender} onChange={(e) => setFilter("gender", e.target.value)}>
              <option value="all">All</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </Field>
          <Field label="Center" htmlFor="f-center">
            <select id="f-center" className={selectClass} value={filters.center} onChange={(e) => setFilter("center", e.target.value)}>
              <option value="all">All Centers</option>
              {report?.options.centers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Member source" htmlFor="f-source">
            <select id="f-source" className={selectClass} value={filters.source} onChange={(e) => setFilter("source", e.target.value)}>
              <option value="all">All</option>
              <option value="excel_import">Excel Import</option>
              <option value="quick_entry">Quick Entry</option>
            </select>
          </Field>
          {activeFilters > 0 && (
            // Beside the last label on wider screens, so appearing doesn't move anything.
            <button
              type="button"
              onClick={() => { setFilters(NO_FILTERS); setPage(1); }}
              className="min-h-11 self-end rounded-control font-semibold text-brand hover:underline md:absolute md:top-0 md:right-0 md:min-h-5"
            >
              Clear filters
            </button>
          )}
        </section>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-control bg-danger-soft px-3 py-1.5 text-danger">
          <p role="alert">{error}{updatedAt ? ` These numbers are from ${formatTime(updatedAt)}.` : ""}</p>
          <button type="button" onClick={() => load()} className="min-h-9 shrink-0 font-semibold underline">Retry</button>
        </div>
      )}

      {noMembers && (
        <p className="rounded-card border border-dashed border-control px-4 py-3">
          No members yet. <Link href="/admin/members" className="font-semibold text-brand underline">Upload the member Excel</Link> so officers can find people when you start an event.
        </p>
      )}

      {!s && !error && <SummarySkeleton />}

      {s && (
        <>
          <SummaryStrip s={s} gender={filters.gender} />
          <DayWise rows={s.byDay} gender={filters.gender} />

          <section aria-label="Attendance records" className="rounded-card border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-base font-semibold">Attendance report</h2>
                <p className="text-muted" data-testid="source-split">
                  {s.total} records: {s.fromExcel} Excel Import, {s.fromQuickEntry} Quick Entry
                  {updatedAt ? `. Updated ${formatTime(updatedAt)}` : ""}
                </p>
              </div>
              <div className="hidden md:block"><ExportLink query={query} /></div>
            </div>

            <RecordsTable records={report.records} onCancel={setCancelling} />

            {s.total > report.pageSize && (
              <div className="border-t border-rule p-4">
                <Pagination
                  page={page}
                  hasNext={page * report.pageSize < s.total}
                  onPage={setPage}
                  summary={`Showing ${(page - 1) * report.pageSize + 1}–${Math.min(page * report.pageSize, s.total)} of ${s.total}`}
                />
              </div>
            )}
          </section>
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
              toast("success", "Attendance removed. The correction is in the Activity Log.");
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
  return (
    <a
      href={`/api/admin/report/export?${query}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-control border border-control bg-white px-4 text-sm font-semibold transition-colors duration-150 hover:border-muted hover:bg-canvas"
    >
      <Download aria-hidden size={16} />
      Export to Excel
    </a>
  );
}

function SummarySkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-[1.3fr_1fr_1fr_1fr_1.3fr]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`bg-white p-4 ${i === 0 ? "col-span-2 lg:col-span-1" : ""}`}>
          <div className="h-5 w-24 rounded bg-canvas" />
          <div className="mt-2 h-8 w-14 rounded bg-canvas" />
        </div>
      ))}
    </div>
  );
}

function Figure({ label, value, note, swatch, lead, testId, className = "" }: { label: string; value: number | string; note?: string; swatch?: string; lead?: boolean; testId: string; className?: string }) {
  return (
    <div className={`bg-white p-4 ${className}`}>
      <p className="flex items-center gap-1.5 text-muted">
        {swatch && <span aria-hidden className={`size-2.5 rounded-full ${swatch}`} />}
        {label}
      </p>
      <p className={`mt-0.5 font-semibold ${lead ? "text-[2rem] leading-10" : "text-2xl leading-10"}`} data-testid={testId}>{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function SummaryStrip({ s, gender }: { s: Summary; gender: string }) {
  const difference = s.male - s.female;
  const showSplit = gender === "all" && s.total > 0;
  const malePercent = s.total > 0 ? Math.round((s.male / s.total) * 100) : 0;
  return (
    <section aria-label="Summary" className="overflow-hidden rounded-card border border-line bg-line">
      <div className="grid grid-cols-2 gap-px lg:grid-cols-[1.3fr_1fr_1fr_1fr_1.3fr]">
        <Figure lead label="Combined attendees" value={s.total} note={`${s.uniqueMembers} unique members`} testId="stat-total" className="col-span-2 lg:col-span-1" />
        <Figure label="Male" value={s.male} swatch="bg-male" testId="stat-male" />
        <Figure label="Female" value={s.female} swatch="bg-female" testId="stat-female" />
        <Figure
          label="Male minus Female"
          value={difference === 0 ? "0" : `${difference > 0 ? "+" : "−"}${Math.abs(difference)}`}
          note={difference === 0 ? "Equal" : `${Math.abs(difference)} more ${difference > 0 ? "male" : "female"} attendees`}
          testId="stat-difference"
        />
        <Figure label="New by Quick Entry today" value={s.quickEntryToday} note={`${s.quickEntryInSelection} in these filters`} testId="stat-quick" />
      </div>
      {showSplit && (
        <div className="mt-px bg-white px-4 py-3">
          <div className="flex gap-0.5" role="img" aria-label={`${malePercent}% male, ${100 - malePercent}% female`}>
            {s.male > 0 && <div className="h-2.5 rounded-l-sm bg-male last:rounded-r-sm" style={{ flexGrow: s.male }} />}
            {s.female > 0 && <div className="h-2.5 rounded-r-sm bg-female first:rounded-l-sm" style={{ flexGrow: s.female }} />}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>Male {malePercent}%</span>
            <span>Female {100 - malePercent}%</span>
          </div>
        </div>
      )}
    </section>
  );
}

function DayWise({ rows, gender }: { rows: DayRow[]; gender: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const showMale = gender !== "Female";
  const showFemale = gender !== "Male";
  return (
    <section aria-label="Event day-wise attendance" className="rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-2">
        <h2 className="text-base font-semibold">By event day and date</h2>
        {showMale && showFemale && (
          <ul className="flex gap-3 text-xs text-muted">
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-male" />Male</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-female" />Female</li>
          </ul>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-muted">No attendance for these filters yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 pl-4 font-normal">Event</th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">Male</th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">Female</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal md:pr-6">Total</th>
              <th scope="col" className="hidden w-1/2 py-2 pr-4 font-normal md:table-cell"><span className="sr-only">Chart</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.eventDay}-${r.date}`} className="border-t border-rule">
                <td className="py-2.5 pr-3 pl-4">
                  <span className="block font-medium whitespace-nowrap">{r.eventName}</span>
                  <span className="block text-xs whitespace-nowrap text-muted">{formatDate(r.date)}</span>
                </td>
                <td className="py-2.5 pr-3 text-right">{r.male}</td>
                <td className="py-2.5 pr-3 text-right">{r.female}</td>
                <td className="py-2.5 pr-4 text-right font-semibold md:pr-6">{r.total}</td>
                <td className="hidden py-2.5 pr-4 md:table-cell">
                  <div className="flex gap-0.5" style={{ width: `${(r.total / max) * 100}%` }}>
                    {showMale && r.male > 0 && <BarPart row={r} value={r.male} label="male" className="bg-male" />}
                    {showFemale && r.female > 0 && <BarPart row={r} value={r.female} label="female" className="bg-female" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BarPart({ row, value, label, className }: { row: DayRow; value: number; label: string; className: string }) {
  return (
    <div className="group relative py-1" style={{ flexGrow: value, flexBasis: 0 }}>
      <div className={`h-3 rounded-[3px] ${className}`} />
      <div role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 hidden rounded-control bg-ink px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg group-hover:block">
        {row.eventName}: {value} {label} of {row.total}
      </div>
    </div>
  );
}

function RecordsTable({ records, onCancel }: { records: AttendanceRecord[]; onCancel: (record: AttendanceRecord) => void }) {
  if (records.length === 0) {
    return <p className="border-t border-rule p-4 text-muted">No attendance records for these filters yet. They appear here as officers mark people present.</p>;
  }
  return (
    <>
      {/* Phones get two-line rows rather than a table scrolling sideways. Every field is kept. */}
      <ul className="divide-y divide-rule border-t border-rule lg:hidden">
        {records.map((r) => (
          <li key={r.id} className="flex items-start gap-2 py-2.5 pr-1.5 pl-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{r.name}</p>
              <p className="text-muted">{[r.global_member_id, r.mobile, r.gender, r.center].filter(Boolean).join(" · ")}</p>
              <p className="text-muted">{r.event_name.replace("Gyansatr ", "")}, {formatDateTime(r.marked_at)}</p>
              <p className="text-muted">
                {r.marked_by} · <span className={r.created_source === "quick_entry" ? "font-medium text-ink" : ""}>{SOURCE_LABEL[r.created_source]}</span>
              </p>
            </div>
            <RowAction tone="quiet" onClick={() => onCancel(r)}>Remove</RowAction>
          </li>
        ))}
      </ul>

      <div className="hidden lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-t border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 pl-4 font-normal whitespace-nowrap">Name</th>
              <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">Member ID</th>
              <th scope="col" className="py-2 pr-3 font-normal">Mobile</th>
              <th scope="col" className="py-2 pr-3 font-normal">Gender</th>
              <th scope="col" className="py-2 pr-3 font-normal">Center</th>
              <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">Event and time</th>
              <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">Marked by</th>
              <th scope="col" className="py-2 pr-3 font-normal">Source</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t border-rule">
                <td className="py-2 pr-3 pl-4 font-medium">{r.name}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{r.global_member_id ?? <span className="text-muted">—</span>}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.mobile}</td>
                <td className="py-2 pr-3 text-muted">{r.gender}</td>
                <td className="py-2 pr-3 text-muted">{r.center}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.event_name.replace("Gyansatr ", "")}, {formatDateTime(r.marked_at)}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.marked_by}</td>
                <td className={`py-2 pr-3 whitespace-nowrap ${r.created_source === "quick_entry" ? "font-medium" : "text-muted"}`}>{SOURCE_LABEL[r.created_source]}</td>
                <td className="py-1 pr-2 text-right"><RowAction tone="quiet" onClick={() => onCancel(r)}>Remove</RowAction></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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
        <input id="cancel-reason" autoFocus maxLength={300} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy || !reason.trim()} onClick={submit}>{busy ? "Removing…" : "Remove Attendance"}</Button>
      </div>
    </div>
  );
}
