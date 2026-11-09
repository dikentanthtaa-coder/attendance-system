"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarCheck, Hash, MapPin, Pencil, Phone, SearchX, Trash2, Upload, UsersRound } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  FileDrop,
  GenderBadge,
  MetaList,
  Modal,
  ModalActions,
  PageHeader,
  Pagination,
  PersonCell,
  PersonRow,
  SearchInput,
  Select,
  Skeleton,
  SourceBadge,
  StatList,
  TextInput,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/client-api";
import { CENTERS, type Gender, type MemberSource } from "@/lib/shared";

type ImportSummary = {
  fileName: string;
  totalRows: number;
  imported: number;
  updated: number;
  errorRows: number;
  errors: { row: number; memberId: string; name: string; errors: string[] }[];
};

type Member = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string;
  gender: Gender;
  center: string;
  created_source: MemberSource;
  attendance_count: number;
};

type MemberPage = { members: Member[]; total: number; pageSize: number };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const COLUMNS = ["No", "MemberID", "Name", "Mo.no.", "Gender", "Center"];

export function MembersAdmin() {
  const [refreshKey, setRefreshKey] = useState(0);
  // null until the list first loads. Uploading is a one-off job, so it only starts open with no members.
  const [uploadOpen, setUploadOpen] = useState<boolean | null>(null);
  return (
    <>
      <PageHeader
        title="Members"
        description="Upload the member list, then search, correct or remove anyone in it."
        actions={
          <Button variant="secondary" icon={Upload} aria-expanded={Boolean(uploadOpen)} onClick={() => setUploadOpen((open) => !open)}>
            Upload Excel
          </Button>
        }
      />
      {/* Stays mounted while closed, so an upload's result is still there when it's reopened. */}
      <div className={uploadOpen ? "" : "hidden"}>
        <UploadCard onImported={() => setRefreshKey((k) => k + 1)} />
      </div>
      <MemberList refreshKey={refreshKey} onFirstLoad={(total) => setUploadOpen((open) => open ?? total === 0)} />
    </>
  );
}

function UploadCard({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Please choose an Excel file.");
    if (file.size > MAX_UPLOAD_BYTES) return setError("The file is larger than 4 MB. Please split it into smaller files.");

    setBusy(true);
    setError("");
    setSummary(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<ImportSummary>("/api/admin/members/import", { body: form });
      setSummary(result);
      onImported();
      if (fileRef.current) fileRef.current.value = "";
      setFileName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-label="Excel upload">
      <CardHeader title="Upload member Excel" description="Uploading a MemberID that already exists updates that member." />
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-semibold">First row must have:</span>
          {COLUMNS.map((c) => <Badge key={c} tone="brand">{c}</Badge>)}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <FileDrop
            label="Excel file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            note=".xlsx file, up to 4 MB"
            fileName={fileName}
            inputRef={fileRef}
            onChange={(name) => {
              setFileName(name);
              setError("");
            }}
          />
          <Button type="submit" icon={Upload} loading={busy} disabled={!fileName} className="self-end">
            {busy ? "Uploading…" : "Upload file"}
          </Button>
        </form>

        {error && <Alert tone="danger" title={error} />}

        {summary && (
          <div className="flex flex-col gap-3 border-t border-rule pt-4" data-testid="import-summary">
            <p className="font-semibold break-all">Upload result: {summary.fileName}</p>
            <StatList
              items={[
                { label: "Total rows", value: summary.totalRows },
                { label: "New members", value: summary.imported, tone: "ok" },
                { label: "Updated", value: summary.updated },
                { label: "Rows with errors", value: summary.errorRows, tone: summary.errorRows > 0 ? "danger" : undefined },
              ]}
            />
            {summary.errors.length > 0 && (
              <Alert tone="warn" title="These rows were not imported. Correct them in the file and upload it again.">
                <ul className="mt-2 divide-y divide-warn/20">
                  {summary.errors.map((row) => (
                    <li key={row.row} className="grid gap-x-4 py-2 sm:grid-cols-[4rem_8rem_12rem_1fr]">
                      <span className="font-semibold">Row {row.row}</span>
                      <span className="text-muted">{row.memberId || "No MemberID"}</span>
                      <span className="break-words">{row.name || "No name"}</span>
                      <span className="font-medium text-danger">{row.errors.join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function MemberList({ refreshKey, onFirstLoad }: { refreshKey: number; onFirstLoad: (total: number) => void }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MemberPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<MemberPage>(`/api/admin/members?q=${encodeURIComponent(search)}&page=${page}`, { signal: controller.signal })
        .then((result) => {
          setData(result);
          setLoadError("");
          onFirstLoad(result.total);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setLoadError(err.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFirstLoad is a new function each render and must not refetch
  }, [search, page, refreshKey, reloadKey]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/admin/members/${deleting.id}`, { method: "DELETE" });
      toast("success", `Deleted: ${deleting.name}`);
      reload();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const actions = (m: Member) => (
    <>
      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(m)}>Edit</Button>
      <Button variant="ghost-danger" size="sm" icon={Trash2} onClick={() => setDeleting(m)}>Delete</Button>
    </>
  );

  const columns: Column<Member>[] = [
    { key: "name", header: "Name", cell: (m) => <PersonCell name={m.name} gender={m.gender} /> },
    { key: "id", header: "Member ID", nowrap: true, cell: (m) => m.global_member_id ?? <span className="text-muted">—</span> },
    { key: "mobile", header: "Mobile", nowrap: true, cell: (m) => <span className="text-muted">{m.mobile}</span> },
    { key: "gender", header: "Gender", cell: (m) => <GenderBadge gender={m.gender} /> },
    { key: "center", header: "Center", cell: (m) => <span className="text-muted">{m.center}</span> },
    { key: "source", header: "Source", cell: (m) => <SourceBadge source={m.created_source} /> },
    { key: "days", header: "Days present", align: "right", cell: (m) => <span className="font-semibold">{m.attendance_count}</span> },
    { key: "actions", header: "Actions", hideHeader: true, align: "right", nowrap: true, cell: actions },
  ];

  return (
    <Card aria-label="Member list" className="overflow-hidden">
      <CardHeader
        title={`All members${data ? ` (${data.total})` : ""}`}
        actions={
          <div className="w-full sm:w-80">
            <Field label="Search members" htmlFor="member-list-search">
              <SearchInput
                id="member-list-search"
                placeholder="Member ID, name or mobile"
                value={search}
                onClear={() => {
                  setSearch("");
                  setPage(1);
                }}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
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
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}
        </div>
      )}

      {data && data.members.length === 0 && (
        search ? (
          <EmptyState icon={SearchX} titleAs="p" title={`No member matches “${search}”`} description="Check the spelling or try the mobile number." />
        ) : (
          <EmptyState icon={UsersRound} titleAs="p" title="No members yet" description="Upload the member Excel above, or officers can add people with Quick Entry during an event." />
        )
      )}

      {data && data.members.length > 0 && (
        <DataTable
          rows={data.members}
          columns={columns}
          rowKey={(m) => m.id}
          mobileRow={(m) => (
            <PersonRow
              name={m.name}
              gender={m.gender}
              meta={
                <MetaList
                  items={[
                    m.global_member_id ? { icon: Hash, label: m.global_member_id, strong: true } : null,
                    { icon: Phone, label: m.mobile },
                    { icon: MapPin, label: m.center },
                    { icon: CalendarCheck, label: `Present ${m.attendance_count} of 3 days` },
                  ]}
                />
              }
              footer={
                <>
                  <GenderBadge gender={m.gender} />
                  <SourceBadge source={m.created_source} />
                  <span className="ml-auto flex gap-1">{actions(m)}</span>
                </>
              }
            />
          )}
        />
      )}

      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit member">
        {editing && (
          <EditForm
            key={editing.id}
            member={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              toast("success", "Member updated");
              reload();
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete member"
        danger
        busy={busy}
        confirmLabel="Delete Member"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        message={
          deleting && (
            <>
              Delete <strong className="font-semibold">{deleting.name}</strong>?
              {deleting.attendance_count > 0 && (
                <> Their attendance for <strong className="font-semibold">{deleting.attendance_count} day(s)</strong> will be removed from reports too.</>
              )}
            </>
          )
        }
      />
    </Card>
  );
}

function EditForm({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    globalMemberId: member.global_member_id ?? "",
    name: member.name,
    mobile: member.mobile,
    gender: member.gender as string,
    center: member.center,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/members/${member.id}`, { method: "PATCH", json: form });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="edit-name">
        <TextInput id="edit-name" required maxLength={120} value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Mobile Number" htmlFor="edit-mobile">
        <TextInput id="edit-mobile" required type="tel" value={form.mobile} onChange={set("mobile")} />
      </Field>
      <Field label="Gender" htmlFor="edit-gender">
        <Select id="edit-gender" value={form.gender} onChange={set("gender")}>
          <option>Male</option>
          <option>Female</option>
        </Select>
      </Field>
      <Field label="Center" htmlFor="edit-center">
        <TextInput id="edit-center" required maxLength={80} list="edit-center-list" autoComplete="off" value={form.center} onChange={set("center")} />
        <datalist id="edit-center-list">
          {CENTERS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="Global Member ID" hint="(optional)" htmlFor="edit-id">
        <TextInput id="edit-id" maxLength={50} autoComplete="off" value={form.globalMemberId} onChange={set("globalMemberId")} />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>{busy ? "Saving…" : "Save member"}</Button>
      </ModalActions>
    </form>
  );
}
