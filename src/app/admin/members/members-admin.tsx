"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarCheck, FileUp, Hash, MapPin, Pencil, Phone, SearchX, SlidersHorizontal, Trash2, Upload, UserPlus, UsersRound, X } from "lucide-react";
import { CenterSelect, centerName, centerValue, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { DigitsField } from "@/components/digits-field";
import { PasswordConfirm } from "@/components/password-confirm";
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
  SourceBadge,
  StatList,
  TextInput,
  useToast,
  type Column,
  type SelectOption,
} from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { MEMBER_ID_DIGITS, memberIdInputValue, mobileInputValue, SOURCE_LABEL, type Gender, type MemberSource } from "@/lib/shared";

type ImportSummary = {
  fileName: string;
  totalRows: number;
  imported: number;
  updated: number;
  removed: number;
  removedAttendance: number;
  errorRows: number;
  errors: { row: number; memberId: string; name: string; errors: string[] }[];
};

type Member = {
  id: number;
  global_member_id: string | null;
  name: string;
  mobile: string | null;
  gender: Gender;
  center: string;
  created_source: MemberSource;
  attendance_count: number;
};

type MemberPage = { members: Member[]; total: number; pageSize: number; centers: string[] };

/** Narrows the list. "all" means that filter is off. */
type Filters = { gender: string; center: string; source: string; days: string };
const NO_FILTERS: Filters = { gender: "all", center: "all", source: "all", days: "all" };
/** Which search and filters a list was loaded for, to tell when the one on screen is out of date. */
const listKey = (q: string, f: Filters) => JSON.stringify([q, f.gender, f.center, f.source, f.days]);

const GENDER_FILTER: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];
const SOURCE_FILTER: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "excel_import", label: SOURCE_LABEL.excel_import },
  { value: "quick_entry", label: SOURCE_LABEL.quick_entry },
];
const DAYS_FILTER: SelectOption[] = [
  { value: "all", label: "Any" },
  { value: "present", label: "At least 1 day" },
  { value: "never", label: "Never present" },
];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const COLUMNS = ["No", "MemberID", "Name", "Mo.no.", "Gender", "Center"];

export function MembersAdmin({ initial }: { initial: MemberPage }) {
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasMembers, setHasMembers] = useState(initial.total > 0);
  // The upload form is always one click away. A new file replaces the list from the last upload.
  const [uploadOpen, setUploadOpen] = useState(false);
  // Keeps the card after an upload so its result can still be read, without the upload form.
  const [uploaded, setUploaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const refresh = () => setRefreshKey((k) => k + 1);
  const showForm = !hasMembers || uploadOpen;
  return (
    <>
      <PageHeader
        title="Members"
        description={hasMembers ? "Search, correct or remove members, add someone new, or upload a new list." : "Upload the member list to begin. After that, add people one at a time."}
        actions={
          hasMembers && (
            <>
              <Button variant="secondary" icon={FileUp} aria-expanded={uploadOpen} onClick={() => setUploadOpen((o) => !o)}>Upload Excel</Button>
              <Button icon={UserPlus} onClick={() => setAdding(true)}>Add Member</Button>
            </>
          )
        }
      />
      {(showForm || uploaded) && (
        <UploadCard
          showForm={showForm}
          replacing={hasMembers}
          onCancel={hasMembers ? () => setUploadOpen(false) : undefined}
          onImported={(summary) => {
            setUploaded(true);
            setUploadOpen(false);
            if (summary.imported + summary.updated > 0) setHasMembers(true);
            if (summary.removed > 0) toast("success", `Member list replaced. ${summary.removed} not in the new file removed.`);
            refresh();
          }}
        />
      )}
      <MemberList refreshKey={refreshKey} initial={initial} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add member">
        {adding && (
          <AddMemberForm
            onClose={() => setAdding(false)}
            onAdded={(name) => {
              setAdding(false);
              toast("success", `Added: ${name}`);
              refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function UploadCard({
  showForm,
  replacing,
  onCancel,
  onImported,
}: {
  showForm: boolean;
  /** A list is already there, so this upload replaces it and needs Admin's password. */
  replacing: boolean;
  onCancel?: () => void;
  onImported: (summary: ImportSummary) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [askPassword, setAskPassword] = useState(false);

  function chosenFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please choose an Excel file.");
      return null;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("The file is larger than 4 MB. Please split it into smaller files.");
      return null;
    }
    return file;
  }

  /** Throws when the password is wrong, so the password dialog can show why and stay open. */
  async function send(file: File, password: string | null) {
    const form = new FormData();
    form.append("file", file);
    if (password !== null) form.append("password", password);
    const result = await api<ImportSummary>("/api/admin/members/import", { body: form });
    setSummary(result);
    setAskPassword(false);
    onImported(result);
    if (fileRef.current) fileRef.current.value = "";
    setFileName("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosenFile()) return;
    setError("");
    if (replacing) return setAskPassword(true);
    setBusy(true);
    setSummary(null);
    try {
      await send(chosenFile()!, null);
    } catch (err) {
      // Someone else uploaded a list meanwhile: this one now replaces it, so ask for the password.
      if (err instanceof ClientApiError && err.code === "password_required") setAskPassword(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmReplace(password: string) {
    const file = chosenFile();
    if (!file) return setAskPassword(false);
    try {
      await send(file, password);
    } catch (err) {
      const code = err instanceof ClientApiError ? err.code : "";
      if (code === "wrong_password" || code === "password_required") throw err;
      // Anything else is about the file, so show it next to the file, not in the password box.
      setAskPassword(false);
      setError((err as Error).message);
    }
  }

  return (
    <Card aria-label="Excel upload">
      {showForm ? (
        <CardHeader
          title={replacing ? "Upload a new member list" : "Upload member Excel"}
          description="Gender can be M, F, Male or Female. Mo.no. can be blank."
        />
      ) : (
        <CardHeader title="Member list uploaded" description="Add anyone else with Add Member, or upload a new list with Upload Excel." />
      )}
      <div className="flex flex-col gap-4 p-4 md:p-5">
        {showForm && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm font-semibold">First row must have:</span>
              {COLUMNS.map((c) => <Badge key={c} tone="brand">{c}</Badge>)}
            </div>
            {replacing && (
              <Alert tone="warn" title="This file replaces the member list you uploaded before.">
                People in the new file keep their attendance. People from the earlier upload who aren&apos;t in it are removed, with their attendance.
                Quick Members and people added with Add Member always stay.
              </Alert>
            )}

            <form onSubmit={submit} className="flex flex-col gap-3">
              <FileDrop
                label="Excel file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                note=".xlsx file"
                fileName={fileName}
                inputRef={fileRef}
                onChange={(name) => {
                  setFileName(name);
                  setError("");
                }}
              />
              {/* On phones each button fills the row, and takes its own line when both don't fit. */}
              <div className="flex flex-wrap justify-end gap-2 max-sm:[&>*]:grow">
                {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
                <Button type="submit" icon={Upload} loading={busy} disabled={!fileName}>
                  {busy ? "Uploading…" : replacing ? "Upload and replace list" : "Upload file"}
                </Button>
              </div>
            </form>
          </>
        )}

        {error && <Alert tone="danger" title={error} />}
        {summary && (
          <div className={`flex flex-col gap-3 ${showForm ? "border-t border-rule pt-4" : ""}`} data-testid="import-summary">
            <p className="font-semibold break-all">Upload result: {summary.fileName}</p>
            {summary.removed > 0 && (
              <p className="text-sm text-muted">
                {summary.removed} member{summary.removed === 1 ? "" : "s"} from the earlier upload weren&apos;t in this file and were removed
                {summary.removedAttendance > 0 ? `, with ${summary.removedAttendance} attendance mark${summary.removedAttendance === 1 ? "" : "s"}` : ""}.
              </p>
            )}
            <StatList
              items={[
                { label: "Total rows", value: summary.totalRows },
                { label: "New members", value: summary.imported, tone: "ok" },
                { label: "Updated", value: summary.updated },
                { label: "Removed", value: summary.removed, tone: summary.removed > 0 ? "danger" : undefined },
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
      <PasswordConfirm
        open={askPassword}
        title="Replace member list"
        confirmLabel="Replace List"
        busyLabel="Uploading…"
        icon={Upload}
        onConfirm={confirmReplace}
        onCancel={() => setAskPassword(false)}
      >
        <p>
          Upload <strong className="break-all">{fileName}</strong> as the new member list? People from the earlier upload who aren&apos;t in this
          file are removed, with their attendance. This can&apos;t be undone.
        </p>
      </PasswordConfirm>
    </Card>
  );
}

function MemberList({ refreshKey, initial }: { refreshKey: number; initial: MemberPage }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(initial);
  const [loadedKey, setLoadedKey] = useState(() => listKey("", NO_FILTERS));
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [deletingFiltered, setDeletingFiltered] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const activeFilters = Object.values(filters).filter((v) => v !== "all").length;
  const filtered = search.trim() !== "" || activeFilters > 0;
  // Until the list for the latest search and filters arrives, its count isn't shown and nothing can be deleted by it.
  const counting = loadedKey !== listKey(search, filters);
  const count = counting ? "…" : String(data.total);
  const setFilter = (key: keyof Filters) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setSearch("");
    setFilters(NO_FILTERS);
    setPage(1);
  };
  const clearDropdowns = () => {
    setFilters(NO_FILTERS);
    setPage(1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ q: search, ...filters, page: String(page) });
      api<MemberPage>(`/api/admin/members?${query}`, { signal: controller.signal })
        .then((result) => {
          setData(result);
          setLoadedKey(listKey(search, filters));
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
  }, [search, filters, page, refreshKey, reloadKey]);

  /** Throws on a wrong password, or when the count changed, so the dialog shows why and stays open. */
  async function deleteFiltered(password: string) {
    try {
      const result = await api<{ deleted: number; removedAttendance: number }>("/api/admin/members/delete-filtered", {
        json: { password, filters: { q: search, ...filters }, expected: data.total },
      });
      setDeletingFiltered(false);
      toast(
        "success",
        `Deleted ${result.deleted} member${result.deleted === 1 ? "" : "s"}` +
          (result.removedAttendance > 0 ? `, with ${result.removedAttendance} attendance mark${result.removedAttendance === 1 ? "" : "s"}.` : "."),
      );
      setPage(1);
      reload();
    } catch (err) {
      // Someone added or changed members meanwhile: show the new count before anything is deleted.
      if (err instanceof ClientApiError && err.code === "list_changed") reload();
      throw err;
    }
  }

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
    { key: "mobile", header: "Mobile", nowrap: true, cell: (m) => <span className="text-muted">{m.mobile ?? "—"}</span> },
    { key: "gender", header: "Gender", cell: (m) => <GenderBadge gender={m.gender} /> },
    { key: "center", header: "Center", cell: (m) => <span className="text-muted">{m.center}</span> },
    { key: "source", header: "Source", cell: (m) => <SourceBadge source={m.created_source} /> },
    { key: "days", header: "Days present", align: "right", cell: (m) => <span className="font-semibold">{m.attendance_count}</span> },
    { key: "actions", header: "Actions", hideHeader: true, align: "right", nowrap: true, cell: actions },
  ];

  return (
    <Card aria-label="Member list" className="overflow-hidden">
      {/* Search first and widest, then the filters. The count and what to do with it sit under them. */}
      <div className="flex flex-col gap-3 border-b border-rule px-4 py-3.5 md:px-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="sm:col-span-2 lg:col-span-1">
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
          {/* Phones open the filters in a pop-up, so the list isn't pushed down by four dropdowns. */}
          <div className="sm:hidden">
            <Button variant="secondary" icon={SlidersHorizontal} className="w-full" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Button>
          </div>
          <div className="hidden sm:contents">
            <FilterFields idPrefix="member-filter" filters={filters} centers={data.centers} onChange={setFilter} />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="min-w-0 text-base font-semibold">{filtered ? `Matching members (${count})` : `All members (${count})`}</h2>
          {filtered && (
            <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
              <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>Clear filters</Button>
              <Button variant="danger-outline" size="sm" icon={Trash2} disabled={counting || data.total === 0} onClick={() => setDeletingFiltered(true)}>
                Delete Filtered ({count})
              </Button>
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <div className="p-4">
          <Alert tone="danger" title={loadError} action={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>} />
        </div>
      )}

      {data.members.length === 0 && (
        filtered ? (
          <EmptyState
            icon={SearchX}
            titleAs="p"
            title={search.trim() ? `No member matches “${search}”` : "No member matches these filters"}
            description={search.trim() ? "Check the spelling, try the mobile number, or clear the filters." : "Try a different filter."}
            action={<Button variant="secondary" icon={X} onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState icon={UsersRound} titleAs="p" title="No members yet" description="Upload the member Excel above, or officers can add people with Quick Entry during an event." />
        )
      )}

      {data.members.length > 0 && (
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
                    m.mobile ? { icon: Phone, label: m.mobile } : null,
                    { icon: MapPin, label: m.center },
                    { icon: CalendarCheck, label: `Present on ${m.attendance_count} day${m.attendance_count === 1 ? "" : "s"}` },
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

      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />

      {/* Choices apply as they're made, so the list behind and the count on the button are always current. */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="flex flex-col gap-4">
          <FilterFields idPrefix="member-filter-popup" filters={filters} centers={data.centers} onChange={setFilter} />
        </div>
        <ModalActions>
          <Button variant="secondary" icon={X} disabled={activeFilters === 0} onClick={clearDropdowns}>Clear filters</Button>
          <Button onClick={() => setFiltersOpen(false)}>{counting ? "Show members" : `Show ${data.total} member${data.total === 1 ? "" : "s"}`}</Button>
        </ModalActions>
      </Modal>

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

      <PasswordConfirm
        open={deletingFiltered}
        title="Delete filtered members"
        confirmLabel={`Delete ${data.total} Member${data.total === 1 ? "" : "s"}`}
        busyLabel="Deleting…"
        icon={Trash2}
        onConfirm={deleteFiltered}
        onCancel={() => setDeletingFiltered(false)}
      >
        <p>
          Delete <strong>{data.total} member{data.total === 1 ? "" : "s"}</strong> who match:
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Filters in use">
          {filterSummary(search, filters).map((f) => <li key={f}><Badge tone="brand">{f}</Badge></li>)}
        </ul>
        <p>Their attendance is removed from every session and report too. This can&apos;t be undone.</p>
      </PasswordConfirm>
    </Card>
  );
}

/** The four filter dropdowns: in a row beside the search on larger screens, in the Filters pop-up on phones. */
function FilterFields({
  idPrefix,
  filters,
  centers,
  onChange,
}: {
  idPrefix: string;
  filters: Filters;
  centers: string[];
  onChange: (key: keyof Filters) => (value: string) => void;
}) {
  // A chosen center stays listed after its last member is deleted, so the box still says what's chosen.
  const centerOptions = [...new Set([...centers, ...(filters.center === "all" ? [] : [filters.center])])];
  return (
    <>
      <Field label="Gender" htmlFor={`${idPrefix}-gender`}>
        <Select id={`${idPrefix}-gender`} value={filters.gender} active={filters.gender !== "all"} options={GENDER_FILTER} onChange={onChange("gender")} />
      </Field>
      <Field label="Center" htmlFor={`${idPrefix}-center`}>
        <Select
          id={`${idPrefix}-center`}
          value={filters.center}
          active={filters.center !== "all"}
          options={[{ value: "all", label: "All Centers" }, ...centerOptions.map((c) => ({ value: c, label: c }))]}
          onChange={onChange("center")}
        />
      </Field>
      <Field label="Member source" htmlFor={`${idPrefix}-source`}>
        <Select id={`${idPrefix}-source`} value={filters.source} active={filters.source !== "all"} options={SOURCE_FILTER} onChange={onChange("source")} />
      </Field>
      <Field label="Days present" htmlFor={`${idPrefix}-days`}>
        <Select id={`${idPrefix}-days`} value={filters.days} active={filters.days !== "all"} options={DAYS_FILTER} onChange={onChange("days")} />
      </Field>
    </>
  );
}

/** The search and filters in use, in words, so Admin can see exactly what Delete Filtered covers. */
function filterSummary(search: string, f: Filters) {
  const label = (options: SelectOption[], value: string) => options.find((o) => o.value === value)?.label ?? value;
  return [
    search.trim() && `Search: “${search.trim()}”`,
    f.gender !== "all" && `Gender: ${label(GENDER_FILTER, f.gender)}`,
    f.center !== "all" && `Center: ${f.center}`,
    f.source !== "all" && `Member source: ${label(SOURCE_FILTER, f.source)}`,
    f.days !== "all" && `Days present: ${label(DAYS_FILTER, f.days)}`,
  ].filter((x): x is string => Boolean(x));
}

const GENDER_OPTIONS: SelectOption[] = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

function EditForm({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    globalMemberId: member.global_member_id ?? "",
    name: member.name,
    mobile: member.mobile ?? "",
    gender: member.gender as string,
  });
  const [center, setCenter] = useState(() => centerValue(member.center));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setValue = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  };
  const mobileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  // Only a new or changed ID has to be 6 digits, so an older one doesn't stop other corrections.
  const idChanged = form.globalMemberId !== (member.global_member_id ?? "");
  const idIncomplete = idChanged && form.globalMemberId.length > 0 && form.globalMemberId.length !== MEMBER_ID_DIGITS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.mobile && form.mobile.length !== 10) {
      mobileRef.current?.focus();
      return setError(`Mobile number must be 10 digits. You entered ${form.mobile.length}.`);
    }
    if (!centerName(center)) return setError("Please choose a center. If you chose Other, type its name.");
    if (idIncomplete) {
      idRef.current?.focus();
      return setError(`Member ID must be ${MEMBER_ID_DIGITS} digits. You entered ${form.globalMemberId.length}.`);
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/members/${member.id}`, { method: "PATCH", json: { ...form, center: centerName(center) } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="edit-name">
        <TextInput id="edit-name" placeholder="e.g. Ghanshyam Pande" required maxLength={120} value={form.name} onChange={set("name")} />
      </Field>
      <DigitsField id="edit-mobile" placeholder="e.g. 9876543210" label="Mobile Number" digits={10} optional type="tel" inputRef={mobileRef} value={form.mobile} clean={mobileInputValue} onValue={setValue("mobile")} />
      <Field label="Gender" htmlFor="edit-gender">
        <Select id="edit-gender" value={form.gender} onChange={(gender) => setForm((f) => ({ ...f, gender }))} options={GENDER_OPTIONS} />
      </Field>
      <Field label="Center" htmlFor="edit-center">
        <CenterSelect id="edit-center" value={center} onChange={setCenter} />
      </Field>
      <DigitsField
        id="edit-id"
        placeholder="e.g. 206383"
        label="Global Member ID"
        digits={MEMBER_ID_DIGITS}
        optional
        showCount={idChanged}
        inputRef={idRef}
        value={form.globalMemberId}
        clean={memberIdInputValue}
        onValue={setValue("globalMemberId")}
      />
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>{busy ? "Saving…" : "Save member"}</Button>
      </ModalActions>
    </form>
  );
}

type NameMatch = { name: string; memberId: string | null; mobile: string | null; center: string };

/** One person at a time, after the Excel list is in. Checked like Quick Entry, but not marked present. */
function AddMemberForm({ onClose, onAdded }: { onClose: () => void; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [gender, setGender] = useState("");
  const [center, setCenter] = useState<CenterValue>(EMPTY_CENTER);
  const [globalMemberId, setGlobalMemberId] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<{ title: string; people: string[]; why: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mobileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  // Any change means the warning no longer fits what's typed, so it goes until the next save.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
    setWarning(null);
  };

  async function save(confirmDuplicate: boolean) {
    setError("");
    if (mobile && mobile.length !== 10) {
      mobileRef.current?.focus();
      return setError(`Mobile number must be 10 digits. You entered ${mobile.length}.`);
    }
    if (!gender) return setError("Please choose a gender.");
    if (!centerName(center)) return setError("Please choose a center. If you chose Other, type its name.");
    if (globalMemberId && globalMemberId.length !== MEMBER_ID_DIGITS) {
      idRef.current?.focus();
      return setError(`Member ID must be ${MEMBER_ID_DIGITS} digits. You entered ${globalMemberId.length}.`);
    }
    setBusy(true);
    try {
      const saved = await api<{ memberName: string }>("/api/admin/members", {
        json: { name, mobile, gender, center: centerName(center), globalMemberId, confirmDuplicate },
      });
      onAdded(saved.memberName);
    } catch (err) {
      setBusy(false);
      if (err instanceof ClientApiError && err.code === "duplicate_mobile") {
        return setWarning({ title: err.message, people: err.data.matches as string[], why: "Family members can share a number." });
      }
      if (err instanceof ClientApiError && err.code === "duplicate_name") {
        const people = (err.data.nameMatches as NameMatch[]).map((m) => [m.name, m.memberId, m.mobile, m.center].filter(Boolean).join(" · "));
        return setWarning({ title: err.message, people, why: "Two people can share a name." });
      }
      setError((err as Error).message);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="flex flex-col gap-4"
    >
      <Field label="Name" htmlFor="add-name">
        <TextInput id="add-name" placeholder="e.g. Ghanshyam Pande" required autoFocus maxLength={120} value={name} onChange={(e) => edit(setName)(e.target.value)} />
      </Field>
      <DigitsField id="add-mobile" placeholder="e.g. 9876543210" label="Mobile Number" digits={10} optional type="tel" inputRef={mobileRef} value={mobile} clean={mobileInputValue} onValue={edit(setMobile)} />
      <Field label="Gender" htmlFor="add-gender">
        <Select id="add-gender" value={gender} onChange={edit(setGender)} options={GENDER_OPTIONS} placeholder="Choose gender" />
      </Field>
      <Field label="Center" htmlFor="add-center">
        <CenterSelect
          id="add-center"
          value={center}
          onChange={(value) => {
            setCenter(value);
            setError("");
            setWarning(null);
          }}
        />
      </Field>
      <DigitsField id="add-id" placeholder="e.g. 206383" label="Global Member ID" digits={MEMBER_ID_DIGITS} optional inputRef={idRef} value={globalMemberId} clean={memberIdInputValue} onValue={edit(setGlobalMemberId)} />

      {warning && (
        <Alert tone="warn" title={warning.title}>
          <ul className="font-semibold">
            {warning.people.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <p className="mt-2">{warning.why} Adding anyway creates a separate member and doesn&apos;t change the existing one.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setWarning(null)}>Go back</Button>
            <Button loading={busy} onClick={() => save(true)}>Add anyway</Button>
          </div>
        </Alert>
      )}
      {error && <Alert tone="danger" title={error} />}

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" icon={UserPlus} loading={busy} disabled={warning !== null}>{busy ? "Adding…" : "Add Member"}</Button>
      </ModalActions>
    </form>
  );
}
