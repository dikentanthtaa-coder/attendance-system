"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, FileBarChart, Hash, MapPin, Phone, SearchX } from "lucide-react";
import { Alert, Button, Card, CardHeader, DataTable, DayCellBadge, EmptyState, Field, GenderBadge, LinkButton, MetaList, PageHeader, Pagination, PersonCell, PersonRow, SourceBadge, SearchInput, Select, StatusBadge, type Column, type SelectOption } from "@/components/ui";
import { api } from "@/lib/client-api";
import { SOURCE_LABEL, type DayCell, type EventStatus, type Gender, type MemberSource } from "@/lib/shared";

type Day = { day: number; name: string; status: EventStatus; present: number; quick: number; totalPresent: number; absent: number | null; notMarked: number | null };

type Row = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string | null;
  gender: Gender;
  center: string;
  created_source: MemberSource;
  present_days: number[];
  cells: Record<string, DayCell>;
};

type Report = { days: Day[]; rows: Row[]; total: number; everyone: number; centers: string[]; pageSize: number };

const GENDER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

function DayStat({ value, label, tone = "", testId }: { value: number; label: string; tone?: string; testId: string }) {
  return (
    <p className="min-w-0">
      <span className={`block text-2xl leading-8 font-bold tabular-nums ${tone}`} data-testid={testId}>{value}</span>
      <span className="block text-sm leading-tight text-muted">{label}</span>
    </p>
  );
}

/** The + and = between the numbers, so the card reads as a sum. */
function Op({ children }: { children: string }) {
  return <span aria-hidden className="text-2xl leading-8 font-semibold text-muted">{children}</span>;
}

export function DayReport({ initial }: { initial: Report }) {
  const [report, setReport] = useState(initial);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("all");
  const [center, setCenter] = useState("all");
  const [show, setShow] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const query = useMemo(() => new URLSearchParams({ q, gender, center, show }).toString(), [q, gender, center, show]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Report>(`/api/admin/day-report?${query}&page=${page}`, { signal: controller.signal })
        .then((result) => {
          setReport(result);
          setError("");
        })
        .catch((err) => {
          if (err.name !== "AbortError") setError(err.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, retryKey]);

  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const { days } = report;
  const showOptions: SelectOption[] = [
    { value: "all", label: "Everyone" },
    ...days.flatMap((d) => [
      { value: `P:${d.day}`, label: `Present on Day ${d.day}` },
      { value: `A:${d.day}`, label: d.status === "ended" ? `Absent on Day ${d.day}` : `Not marked yet on Day ${d.day}` },
    ]),
  ];

  const columns: Column<Row>[] = [
    { key: "name", header: "Name", cell: (r) => <PersonCell name={r.name} gender={r.gender} /> },
    { key: "id", header: "Member ID", nowrap: true, cell: (r) => r.global_member_id ?? <span className="text-muted">—</span> },
    { key: "mobile", header: "Mobile", nowrap: true, cell: (r) => <span className="text-muted">{r.mobile ?? "—"}</span> },
    { key: "gender", header: "Gender", cell: (r) => <GenderBadge gender={r.gender} /> },
    { key: "center", header: "Center", cell: (r) => <span className="text-muted">{r.center}</span> },
    { key: "status", header: "Status", cell: (r) => <SourceBadge source={r.created_source} /> },
    ...days.map((d): Column<Row> => ({ key: `day-${d.day}`, header: `Day ${d.day}`, align: "right", cell: (r) => <DayCellBadge value={r.cells[d.day]} /> })),
  ];

  return (
    <>
      <PageHeader
        title="Report"
        description="P is present. A is absent, filled in automatically when a day ends. A new column appears as each day starts."
        actions={<LinkButton native href={`/api/admin/day-report/export?${query}`} variant="primary" icon={Download}>Download Excel</LinkButton>}
      />

      {days.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} titleAs="p" title="No day has started yet" description="The report begins when you start Day 1 on the Dashboard." /></Card>
      ) : (
        <section aria-label="Totals by day" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((d) => (
            <Card key={d.day} className="p-4" aria-label={`${d.name} totals`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">{d.name}</h2>
                <StatusBadge status={d.status} />
              </div>
              {/* Present + Quick Member = Total Present, then Absent: beside the sum when the card has room, under it when it doesn't. */}
              <div className="@container mt-2">
                <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:gap-5">
                  <div className="flex items-start gap-2.5">
                    <DayStat value={d.present} label="Present" tone="text-ok" testId={`day-${d.day}-present`} />
                    <Op>+</Op>
                    <DayStat value={d.quick} label={SOURCE_LABEL.quick_entry} tone="text-warn" testId={`day-${d.day}-quick`} />
                    <Op>=</Op>
                    <DayStat value={d.totalPresent} label="Total Present" tone="text-brand" testId={`day-${d.day}-total`} />
                  </div>
                  <div className="border-t border-rule pt-3 @md:border-t-0 @md:border-l @md:pt-0 @md:pl-5">
                    {d.absent !== null && <DayStat value={d.absent} label="Absent" tone="text-danger" testId={`day-${d.day}-absent`} />}
                    {d.notMarked !== null && <DayStat value={d.notMarked} label="Not marked yet" testId={`day-${d.day}-not-marked`} />}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      <Card aria-label="Report filters" className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="report-search">
            <SearchInput id="report-search" placeholder="Member ID, name or mobile" value={q} onClear={() => { setQ(""); setPage(1); }} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Show" htmlFor="report-show">
            <Select id="report-show" value={show} active={show !== "all"} options={showOptions} onChange={change(setShow)} />
          </Field>
          <Field label="Gender" htmlFor="report-gender">
            <Select id="report-gender" value={gender} active={gender !== "all"} options={GENDER_OPTIONS} onChange={change(setGender)} />
          </Field>
          <Field label="Center" htmlFor="report-center">
            <Select id="report-center" value={center} active={center !== "all"} options={[{ value: "all", label: "All Centers" }, ...report.centers.map((c) => ({ value: c, label: c }))]} onChange={change(setCenter)} />
          </Field>
        </div>
      </Card>

      {error && <Alert tone="danger" title={error} action={<Button variant="secondary" size="sm" onClick={() => setRetryKey((k) => k + 1)}>Retry</Button>} />}

      <Card aria-label="Report" className="overflow-hidden">
        <CardHeader title={<span className="inline-flex items-center gap-2"><FileBarChart aria-hidden size={16} className="text-muted" />Members ({report.total})</span>} />
        {report.rows.length === 0 ? (
          <EmptyState icon={SearchX} titleAs="p" title="Nobody matches" description="Try a different search or filter." />
        ) : (
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.id}
            mobileRow={(r) => (
              <PersonRow
                name={r.name}
                gender={r.gender}
                nameBadge={<GenderBadge gender={r.gender} />}
                meta={
                  <MetaList
                    items={[
                      r.global_member_id ? { icon: Hash, label: r.global_member_id, strong: true } : null,
                      r.mobile ? { icon: Phone, label: r.mobile } : null,
                      { icon: MapPin, label: r.center },
                    ]}
                  />
                }
                footer={
                  <>
                    <SourceBadge source={r.created_source} />
                    {days.map((d) => (
                      <span key={d.day} className="inline-flex items-center gap-1 text-xs text-muted">
                        Day {d.day} <DayCellBadge value={r.cells[d.day]} />
                      </span>
                    ))}
                  </>
                }
              />
            )}
          />
        )}
        <Pagination page={page} pageSize={report.pageSize} total={report.total} onPage={setPage} />
      </Card>

    </>
  );
}
