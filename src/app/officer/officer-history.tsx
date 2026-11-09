"use client";

import { useEffect, useState } from "react";
import { Clock, Hash, History, MapPin, Phone, UserRoundCheck } from "lucide-react";
import {
  Alert,
  AttendanceBadge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  GenderBadge,
  MetaList,
  Pagination,
  PersonCell,
  PersonRow,
  Select,
  Skeleton,
  type Column,
  type SelectOption,
} from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatTime, type AttendanceStatus, type EventSession, type Gender } from "@/lib/shared";

type HistoryRow = {
  id: number;
  status: AttendanceStatus;
  marked_at: string;
  marked_by: string;
  is_mine: boolean;
  global_member_id: string | null;
  name: string;
  mobile: string;
  gender: Gender;
  center: string;
};

export type HistoryPage = { records: HistoryRow[]; total: number; pageSize: number };

const SCOPE_OPTIONS: SelectOption[] = [
  { value: "mine", label: "Marked by me" },
  { value: "all", label: "All officers" },
];

const markedBy = (r: HistoryRow) => (r.is_mine ? "You" : r.marked_by);

const COLUMNS: Column<HistoryRow>[] = [
  { key: "name", header: "Name", cell: (r) => <PersonCell name={r.name} gender={r.gender} detail={[r.global_member_id, r.mobile].filter(Boolean).join(" · ")} /> },
  { key: "status", header: "Status", cell: (r) => <AttendanceBadge status={r.status} /> },
  { key: "center", header: "Center", cell: (r) => <span className="text-muted">{r.center}</span> },
  { key: "time", header: "Time", nowrap: true, cell: (r) => <span className="text-muted">{formatTime(r.marked_at)}</span> },
  { key: "by", header: "Marked by", cell: (r) => <span className={r.is_mine ? "font-semibold" : "text-muted"}>{markedBy(r)}</span> },
];

/** `version` changes whenever the day's counts do, so a new mark appears here by itself. */
export function OfficerHistory({ event, version, initial }: { event: EventSession; version: string; initial: HistoryPage | null }) {
  const [scope, setScope] = useState("mine");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(initial);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<HistoryPage>(`/api/officer/history?day=${event.event_day}&scope=${scope}&page=${page}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [event.event_day, scope, page, version, retryKey]);

  return (
    <Card aria-label="Attendance history" className="overflow-hidden">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><History aria-hidden size={16} className="text-muted" />History{data ? ` (${data.total})` : ""}</span>}
        description={event.name}
        actions={
          <div className="w-full sm:w-48">
            <Field label="Show" htmlFor="history-scope">
              <Select id="history-scope" value={scope} options={SCOPE_OPTIONS} onChange={(v) => { setScope(v); setPage(1); }} />
            </Field>
          </div>
        }
      />

      {error && (
        <div className="p-4">
          <Alert tone="danger" title={error} action={<Button variant="secondary" size="sm" onClick={() => setRetryKey((k) => k + 1)}>Retry</Button>} />
        </div>
      )}

      {!data && !error && (
        <div aria-hidden className="flex flex-col gap-3 p-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
        </div>
      )}

      {data && data.records.length === 0 && (
        <EmptyState
          icon={History}
          titleAs="p"
          title={scope === "mine" ? "You haven't marked anyone yet" : "Nobody has been marked yet"}
          description="People appear here as soon as they're marked Present or Absent."
        />
      )}

      {data && data.records.length > 0 && (
        <DataTable
          rows={data.records}
          columns={COLUMNS}
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
                    { icon: Clock, label: formatTime(r.marked_at) },
                    { icon: UserRoundCheck, label: markedBy(r) },
                  ]}
                />
              }
              footer={
                <>
                  <AttendanceBadge status={r.status} />
                  <GenderBadge gender={r.gender} />
                </>
              }
            />
          )}
        />
      )}

      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}
