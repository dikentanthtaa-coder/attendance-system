"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CalendarDays, Check, Mail, Phone, RotateCcw, SearchX, UsersRound } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  MetaList,
  OfficerStatusBadge,
  PageHeader,
  Pagination,
  PersonCell,
  PersonRow,
  SearchInput,
  Select,
  Skeleton,
  useToast,
  type Column,
  type SelectOption,
} from "@/components/ui";
import { api } from "@/lib/client-api";
import { formatDateTime, type OfficerStatus } from "@/lib/shared";

type Officer = {
  id: string;
  display_name: string;
  mobile: string;
  email: string;
  approval_status: OfficerStatus;
  created_at: string;
};

type OfficerPage = { officers: Officer[]; total: number; pending: number; pageSize: number };

const STATUS_OPTIONS: SelectOption[] = [
  { value: "all", label: "All officers" },
  { value: "pending", label: "Waiting for approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "No access" },
];

export function OfficersAdmin() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OfficerPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [removing, setRemoving] = useState<Officer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<OfficerPage>(`/api/admin/officers?q=${encodeURIComponent(search)}&status=${status}&page=${page}`, { signal: controller.signal })
        .then((result) => {
          setData(result);
          setLoadError("");
        })
        .catch((err) => {
          if (err.name !== "AbortError") setLoadError(err.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, page, reloadKey]);

  async function review(officer: Officer, action: "approve" | "reject") {
    setBusyId(officer.id);
    try {
      await api(`/api/admin/officers/${officer.id}`, { method: "PATCH", json: { action } });
      toast("success", action === "approve" ? `Approved: ${officer.display_name}` : `No access: ${officer.display_name}`);
      reload();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusyId(null);
      setRemoving(null);
    }
  }

  const actions = (o: Officer) => (
    <>
      {o.approval_status !== "approved" && (
        <Button variant={o.approval_status === "pending" ? "success" : "ghost"} size="sm" icon={o.approval_status === "pending" ? Check : RotateCcw} loading={busyId === o.id} onClick={() => review(o, "approve")}>
          {o.approval_status === "pending" ? "Approve" : "Restore access"}
        </Button>
      )}
      {o.approval_status !== "rejected" && (
        <Button variant="ghost-danger" size="sm" icon={Ban} onClick={() => setRemoving(o)}>
          {o.approval_status === "pending" ? "Reject" : "Remove access"}
        </Button>
      )}
    </>
  );

  const columns: Column<Officer>[] = [
    { key: "name", header: "Name", cell: (o) => <PersonCell name={o.display_name} /> },
    { key: "mobile", header: "Mobile", nowrap: true, cell: (o) => <span className="text-muted">{o.mobile}</span> },
    { key: "email", header: "Email", cell: (o) => <span className="break-all text-muted">{o.email}</span> },
    { key: "registered", header: "Registered", nowrap: true, cell: (o) => <span className="text-muted">{formatDateTime(o.created_at)}</span> },
    { key: "status", header: "Status", cell: (o) => <OfficerStatusBadge status={o.approval_status} /> },
    { key: "actions", header: "Actions", hideHeader: true, align: "right", nowrap: true, cell: actions },
  ];

  const filtered = search !== "" || status !== "all";

  return (
    <>
      <PageHeader title="Attendance Officers" description="Approve new officers, or remove access for anyone who no longer needs it." />

      {data && data.pending > 0 && (
        <Alert
          tone="info"
          title={`${data.pending} ${data.pending === 1 ? "officer is" : "officers are"} waiting for your approval.`}
          action={status !== "pending" && <Button variant="secondary" size="sm" onClick={() => { setStatus("pending"); setPage(1); }}>Show them</Button>}
        />
      )}

      <Card aria-label="Officer list" className="overflow-hidden">
        <CardHeader
          title={`Officers${data ? ` (${data.total})` : ""}`}
          actions={
            <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[13rem_18rem]">
              <Field label="Status" htmlFor="officer-status">
                <Select id="officer-status" value={status} active={status !== "all"} options={STATUS_OPTIONS} onChange={(v) => { setStatus(v); setPage(1); }} />
              </Field>
              <Field label="Search officers" htmlFor="officer-search">
                <SearchInput
                  id="officer-search"
                  placeholder="Name, mobile or email"
                  value={search}
                  onClear={() => { setSearch(""); setPage(1); }}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </Field>
            </div>
          }
        />

        {loadError && (
          <div className="p-4">
            <Alert tone="danger" title={loadError} action={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>} />
          </div>
        )}

        {!data && !loadError && (
          <div aria-hidden className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
          </div>
        )}

        {data && data.officers.length === 0 && (
          filtered ? (
            <EmptyState icon={SearchX} titleAs="p" title="No officers match" description="Try a different name, or change the status." />
          ) : (
            <EmptyState icon={UsersRound} titleAs="p" title="No officers yet" description="Share the website link. New officers can register from the login page, and they appear here for approval." />
          )
        )}

        {data && data.officers.length > 0 && (
          <DataTable
            rows={data.officers}
            columns={columns}
            rowKey={(o) => o.id}
            mobileRow={(o) => (
              <PersonRow
                name={o.display_name}
                meta={
                  <MetaList
                    items={[
                      { icon: Phone, label: o.mobile },
                      { icon: Mail, label: <span className="break-all">{o.email}</span> },
                      { icon: CalendarDays, label: `Registered ${formatDateTime(o.created_at)}` },
                    ]}
                  />
                }
                footer={
                  <>
                    <OfficerStatusBadge status={o.approval_status} />
                    <span className="ml-auto flex gap-1">{actions(o)}</span>
                  </>
                }
              />
            )}
          />
        )}

        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      <ConfirmDialog
        open={removing !== null}
        title={removing?.approval_status === "pending" ? "Reject registration" : "Remove access"}
        danger
        busy={busyId !== null}
        confirmLabel={removing?.approval_status === "pending" ? "Reject" : "Remove Access"}
        onConfirm={() => removing && review(removing, "reject")}
        onCancel={() => setRemoving(null)}
        message={
          removing && (
            <>
              <strong className="font-semibold">{removing.display_name}</strong> won&apos;t be able to log in or mark attendance. Attendance they already marked stays in the reports, and you can restore their access later.
            </>
          )
        }
      />
    </>
  );
}
