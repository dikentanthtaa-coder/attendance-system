"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { api, Button, Field, inputClass, Modal, Pagination } from "@/components/ui";
import { formatDate, formatDateTime, SOURCE_LABEL, type Gender, type MemberSource } from "@/lib/shared";

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

const selectClass = `${inputClass} text-sm`;

export function Dashboard() {
  const toast = useToast();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<AttendanceRecord | null>(null);

  const query = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<Report>(`/api/admin/report?${query}&page=${page}`, { signal });
      setReport(data);
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

  const s = report?.summary;
  const isFiltered = query !== new URLSearchParams(NO_FILTERS).toString();

  return (
    <>
      <section aria-label="Filters" className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-[repeat(5,1fr)_auto] md:items-end">
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
        <Button variant="ghost" disabled={!isFiltered} className="disabled:opacity-40" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear</Button>
      </section>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {s && (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Male Attendees" value={s.male} swatch="bg-male" testId="stat-male" />
            <Stat label="Female Attendees" value={s.female} swatch="bg-female" testId="stat-female" />
            <Stat label="Combined" value={s.total} note={`${s.uniqueMembers} unique members`} testId="stat-total" />
            <Stat
              label="Male − Female"
              value={s.male - s.female === 0 ? "0" : `${s.male > s.female ? "+" : "−"}${Math.abs(s.male - s.female)}`}
              note={s.male === s.female ? "Equal" : `${s.male > s.female ? "More male" : "More female"} attendees`}
              testId="stat-difference"
            />
            <Stat
              label="Quick Entry today"
              value={s.quickEntryToday}
              note={`${s.quickEntryInSelection} new members in selection`}
              testId="stat-quick"
            />
          </section>

          <DayWise rows={s.byDay} gender={filters.gender} />

          <section aria-label="Attendance records" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Attendance report</h2>
                <p className="text-sm text-muted" data-testid="source-split">
                  {s.total} records · {s.fromExcel} Excel Import · {s.fromQuickEntry} Quick Entry
                </p>
              </div>
              {/* A plain link to the same query string, so the file holds exactly what's on screen. */}
              <a
                href={`/api/admin/report/export?${query}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Export to Excel
              </a>
            </div>

            <RecordsTable records={report.records} onCancel={setCancelling} />

            <Pagination
              page={page}
              hasNext={page * report.pageSize < s.total}
              onPage={setPage}
              summary={s.total > 0 ? `Showing ${(page - 1) * report.pageSize + 1}–${Math.min(page * report.pageSize, s.total)} of ${s.total}` : undefined}
            />
          </section>
        </>
      )}

      {!s && !error && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

      <CancelDialog
        record={cancelling}
        onClose={() => setCancelling(null)}
        onDone={() => {
          setCancelling(null);
          toast("success", "Attendance removed. The correction is in the Activity Log.");
          load();
        }}
      />
    </>
  );
}

function Stat({ label, value, note, swatch, testId }: { label: string; value: number | string; note?: string; swatch?: string; testId: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {swatch && <span aria-hidden className={`size-2.5 rounded-sm ${swatch}`} />}
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={testId}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

function DayWise({ rows, gender }: { rows: DayRow[]; gender: string }) {
  const days = [...new Set(rows.map((r) => r.eventDay))].map((day) => {
    const dayRows = rows.filter((r) => r.eventDay === day);
    return {
      day,
      name: dayRows[0].eventName,
      male: dayRows.reduce((sum, r) => sum + r.male, 0),
      female: dayRows.reduce((sum, r) => sum + r.female, 0),
    };
  });
  const max = Math.max(1, ...days.flatMap((d) => [d.male, d.female]));
  const series = [
    gender !== "Female" && { key: "male", label: "Male", className: "bg-male" },
    gender !== "Male" && { key: "female", label: "Female", className: "bg-female" },
  ].filter(Boolean) as { key: "male" | "female"; label: string; className: string }[];

  return (
    <section aria-label="Event day-wise attendance" className="grid gap-5 rounded-xl border border-line bg-white p-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Male and female by event day</h2>
          {series.length > 1 && (
            <ul className="flex gap-3 text-xs text-muted">
              {series.map((item) => (
                <li key={item.key} className="flex items-center gap-1.5">
                  <span aria-hidden className={`size-2.5 rounded-sm ${item.className}`} />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        {days.length === 0 && <p className="py-6 text-center text-sm text-muted">No attendance for these filters.</p>}
        {days.map((d) => (
          <div key={d.day} className="grid grid-cols-[3.5rem_1fr] items-center gap-2">
            <p className="text-sm font-medium">Day {d.day}</p>
            <div className="flex flex-col gap-0.5">
              {series.map((item) => {
                const value = d[item.key];
                const totalForDay = d.male + d.female;
                return (
                  <div key={item.key} className="group relative flex items-center gap-2 py-px">
                    <div className="h-3 min-w-0.5 rounded-r-sm" style={{ width: `calc((100% - 3.5rem) * ${value / max})` }}>
                      <div className={`h-full rounded-r-sm ${item.className}`} />
                    </div>
                    <span className="text-xs font-medium tabular-nums">{value}</span>
                    <div role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white group-hover:block">
                      {d.name}: {value} {item.label.toLowerCase()}{totalForDay > 0 && series.length > 1 ? ` (${Math.round((value / totalForDay) * 100)}%)` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Date-wise count</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Event</th>
                <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">Male</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">Female</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={`${r.eventDay}-${r.date}`} className="border-b border-line/60">
                  <td className="py-2 pr-3 whitespace-nowrap">{r.eventName}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-2 pl-3 text-right">{r.male}</td>
                  <td className="py-2 pl-3 text-right">{r.female}</td>
                  <td className="py-2 pl-3 text-right font-semibold">{r.total}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-muted">No attendance for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RecordsTable({ records, onCancel }: { records: AttendanceRecord[]; onCancel: (record: AttendanceRecord) => void }) {
  if (records.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No attendance records for these filters.</p>;
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {["Member ID", "Name", "Mobile", "Gender", "Center", "Event", "Date / Time", "Marked by", "Source"].map((h) => (
              <th key={h} scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>
            ))}
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b border-line/60">
              <td className="py-2 pr-3 font-mono whitespace-nowrap">{r.global_member_id ?? "—"}</td>
              <td className="py-2 pr-3 font-medium">{r.name}</td>
              <td className="py-2 pr-3 font-mono whitespace-nowrap">{r.mobile}</td>
              <td className="py-2 pr-3">{r.gender}</td>
              <td className="py-2 pr-3">{r.center}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{r.event_name.replace("Gyansatr ", "")}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.marked_at)}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{r.marked_by}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.created_source === "quick_entry" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand"}`}>
                  {SOURCE_LABEL[r.created_source]}
                </span>
              </td>
              <td className="py-1 text-right">
                <button type="button" onClick={() => onCancel(r)} className="min-h-9 rounded-md px-2 text-xs font-semibold text-danger hover:bg-danger-soft">
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CancelDialog({ record, onClose, onDone }: { record: AttendanceRecord | null; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={record !== null} onClose={onClose} title="Remove attendance">
      {record && <CancelForm key={record.id} record={record} onClose={onClose} onDone={onDone} />}
    </Modal>
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
      <p className="text-sm">
        Remove <strong>{record.name}</strong> from <strong>{record.event_name}</strong>? If the event is still active, an officer can mark them again.
      </p>
      <Field label="Reason" htmlFor="cancel-reason">
        <input id="cancel-reason" autoFocus maxLength={300} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy || !reason.trim()} onClick={submit}>{busy ? "Removing…" : "Remove Attendance"}</Button>
      </div>
    </div>
  );
}
