"use client";

import { useEffect, useState } from "react";
import { Hash, History, MapPin, Phone, Search, Trash2 } from "lucide-react";
import { RemoveAttendanceForm } from "@/components/remove-attendance";
import { Alert, Button, Card, CardHeader, EmptyState, Field, GenderBadge, MetaList, Modal, Pagination, PersonRow, SearchInput, Select, Skeleton, useToast, type SelectOption } from "@/components/ui";
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

// Short words, so both dropdowns fit side by side on a 320px phone.
const SCOPE_OPTIONS: SelectOption[] = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "Me" },
];

const GENDER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

/**
 * A list rather than a table, as it sits in a side column on large screens and fills a phone on small
 * ones. `version` changes whenever the day's count does, so a new mark appears here by itself.
 * An officer sees everyone of their own gender; only Admin chooses between "me" and everyone, filters
 * by gender, and can remove a mark made by mistake. The search finds people the way marking does.
 */
export function OfficerHistory({
  event,
  version,
  initial,
  isAdmin,
  onRemoved,
}: {
  event: EventSession;
  version: string;
  initial: HistoryPage | null;
  isAdmin: boolean;
  onRemoved?: () => void;
}) {
  const toast = useToast();
  const [removing, setRemoving] = useState<HistoryRow | null>(null);
  // Everyone first: Admin opens History mostly to check or correct officers' marks.
  const [scope, setScope] = useState("all");
  const [gender, setGender] = useState("all");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(initial);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  // A short pause, so each keystroke doesn't send its own request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ day: String(event.event_day), scope, page: String(page) });
    if (query) params.set("q", query);
    if (gender !== "all") params.set("gender", gender);
    api<HistoryPage>(`/api/officer/history?${params}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [event.event_day, scope, gender, query, page, version, retryKey]);

  const onlyMine = isAdmin && scope === "mine";
  const narrowed = query !== "" || gender !== "all" || onlyMine;

  return (
    <Card aria-label="Attendance history" className="overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><History aria-hidden size={16} className="text-muted" />History{data ? ` (${data.total})` : ""}</span>}
        description={event.name}
      />

      <div className="flex flex-col gap-3 border-b border-rule p-4">
        <Field label="Search" hint="Member ID, name or mobile" htmlFor="history-search">
          <SearchInput
            id="history-search"
            placeholder="206383, Ghanshyam Pande, 9876543210"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            value={typed}
            onClear={() => setTyped("")}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
        {isAdmin && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marked by" htmlFor="history-scope">
              <Select id="history-scope" value={scope} options={SCOPE_OPTIONS} onChange={(v) => { setScope(v); setPage(1); }} />
            </Field>
            <Field label="Gender" htmlFor="history-gender">
              <Select id="history-gender" value={gender} active={gender !== "all"} options={GENDER_OPTIONS} onChange={(v) => { setGender(v); setPage(1); }} />
            </Field>
          </div>
        )}
      </div>

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

      {data && data.records.length === 0 && !narrowed && (
        <EmptyState icon={History} titleAs="p" title="Nobody has been marked yet" description="People appear here as soon as they're marked Present." />
      )}

      {data && data.records.length === 0 && narrowed && (
        <EmptyState
          icon={Search}
          titleAs="p"
          title={query ? `Nobody here matches “${query}”` : gender !== "all" ? `No ${gender.toLowerCase()} members here yet` : "You haven't marked anyone yet"}
          description={
            onlyMine
              ? "This list shows only people you marked. Officers' marks are under Everyone."
              : `Only people marked Present on ${event.name} are listed.`
          }
          action={onlyMine && <Button variant="secondary" onClick={() => { setScope("all"); setPage(1); }}>Show Everyone</Button>}
        />
      )}

      {data && data.records.length > 0 && (
        <ul className="divide-y divide-rule lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {data.records.map((r) => (
            <li key={r.id}>
              <PersonRow
                name={r.name}
                gender={r.gender}
                nameBadge={isAdmin && <GenderBadge gender={r.gender} />}
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
                  <>
                    <span className="flex flex-col items-end text-right text-sm">
                      <span className="font-semibold">{formatTime(r.marked_at)}</span>
                      <span className="text-xs text-muted">{r.is_mine ? "You" : r.marked_by}</span>
                    </span>
                    {isAdmin && (
                      <Button variant="ghost-danger" size="sm" icon={Trash2} aria-label={`Remove ${r.name}`} onClick={() => setRemoving(r)}>
                        <span className="hidden sm:inline">Remove</span>
                      </Button>
                    )}
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {isAdmin && (
        <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove attendance">
          {removing && (
            <RemoveAttendanceForm
              key={removing.id}
              attendanceId={removing.id}
              name={removing.name}
              eventName={event.name}
              onClose={() => setRemoving(null)}
              onDone={() => {
                setRemoving(null);
                toast("success", "Attendance removed.");
                setRetryKey((k) => k + 1);
                onRemoved?.();
              }}
            />
          )}
        </Modal>
      )}
    </Card>
  );
}
