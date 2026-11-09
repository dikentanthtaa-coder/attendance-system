"use client";

import { useEffect, useState } from "react";
import { Hash, History, MapPin, Phone } from "lucide-react";
import { Alert, Button, Card, CardHeader, EmptyState, Field, GenderBadge, MetaList, Pagination, PersonRow, Select, Skeleton, type SelectOption } from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatTime, type EventSession, type Gender } from "@/lib/shared";

type HistoryRow = {
  id: number;
  marked_at: string;
  marked_by: string;
  is_mine: boolean;
  global_member_id: string | null;
  name: string;
  mobile: string | null;
  gender: Gender;
  center: string;
};

export type HistoryPage = { records: HistoryRow[]; total: number; pageSize: number };

const SCOPE_OPTIONS: SelectOption[] = [
  { value: "mine", label: "Marked by me" },
  { value: "all", label: "Everyone" },
];

/**
 * A list rather than a table, as it sits in a side column on large screens and fills a phone on small
 * ones. `version` changes whenever the day's count does, so a new mark appears here by itself.
 * An officer sees everyone of their own gender; only Admin chooses between "me" and everyone.
 */
export function OfficerHistory({ event, version, initial, canChooseScope }: { event: EventSession; version: string; initial: HistoryPage | null; canChooseScope: boolean }) {
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
    <Card aria-label="Attendance history" className="overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><History aria-hidden size={16} className="text-muted" />History{data ? ` (${data.total})` : ""}</span>}
        description={event.name}
        actions={canChooseScope && (
          <div className="w-full sm:w-48">
            <Field label="Show" htmlFor="history-scope">
              <Select id="history-scope" value={scope} options={SCOPE_OPTIONS} onChange={(v) => { setScope(v); setPage(1); }} />
            </Field>
          </div>
        )}
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
        <EmptyState icon={History} titleAs="p" title="Nobody has been marked yet" description="People appear here as soon as they're marked Present." />
      )}

      {data && data.records.length > 0 && (
        <ul className="divide-y divide-rule lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {data.records.map((r) => (
            <li key={r.id}>
              <PersonRow
                name={r.name}
                gender={r.gender}
                nameBadge={canChooseScope && <GenderBadge gender={r.gender} />}
                meta={
                  <MetaList
                    items={[
                      r.global_member_id ? { icon: Hash, label: r.global_member_id, strong: true } : null,
                      r.mobile ? { icon: Phone, label: r.mobile } : null,
                      { icon: MapPin, label: r.center },
                    ]}
                  />
                }
                actions={
                  <span className="flex flex-col items-end text-right text-sm">
                    <span className="font-semibold">{formatTime(r.marked_at)}</span>
                    <span className="text-xs text-muted">{r.is_mine ? "You" : r.marked_by}</span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}
