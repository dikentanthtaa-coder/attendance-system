"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarCheck, Hash, MapPin, Pencil, Phone, SearchX, Trash2, Upload, UserPlus, UsersRound } from "lucide-react";
import { CenterSelect, centerName, centerValue, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { DigitsField } from "@/components/digits-field";
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
import { MEMBER_ID_DIGITS, memberIdInputValue, mobileInputValue, type Gender, type MemberSource } from "@/lib/shared";

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
  mobile: string | null;
  gender: Gender;
  center: string;
  created_source: MemberSource;
  attendance_count: number;
};

type MemberPage = { members: Member[]; total: number; pageSize: number };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const COLUMNS = ["No", "MemberID", "Name", "Mo.no.", "Gender", "Center"];

export function MembersAdmin({ initial }: { initial: MemberPage }) {
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  // The Excel list is uploaded once. After that, people are added one at a time with Add Member.
  const [hasMembers, setHasMembers] = useState(initial.total > 0);
  // Keeps the card after an upload so its result can still be read, without the upload form.
  const [uploaded, setUploaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <>
      <PageHeader
        title="Members"
        description={hasMembers ? "Search, correct or remove members, or add someone new." : "Upload the member list to begin. After that, add people one at a time."}
        actions={hasMembers && <Button icon={UserPlus} onClick={() => setAdding(true)}>Add Member</Button>}
      />
      {(!hasMembers || uploaded) && (
        <UploadCard
          showForm={!hasMembers}
          onImported={(summary) => {
            setUploaded(true);
            if (summary.imported + summary.updated > 0) setHasMembers(true);
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

function UploadCard({ showForm, onImported }: { showForm: boolean; onImported: (summary: ImportSummary) => void }) {
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
      onImported(result);
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
      {showForm ? (
        <CardHeader title="Upload member Excel" description="Gender can be M, F, Male or Female. Mo.no. can be blank. Uploading a MemberID that already exists updates that member." />
      ) : (
        <CardHeader title="Member list uploaded" description="Add anyone else with Add Member." />
      )}
      <div className="flex flex-col gap-4 p-4 md:p-5">
        {showForm && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm font-semibold">First row must have:</span>
              {COLUMNS.map((c) => <Badge key={c} tone="brand">{c}</Badge>)}
            </div>

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
              <Button type="submit" icon={Upload} loading={busy} disabled={!fileName} className="self-end">
                {busy ? "Uploading…" : "Upload file"}
              </Button>
            </form>
          </>
        )}

        {error && <Alert tone="danger" title={error} />}

        {summary && (
          <div className={`flex flex-col gap-3 ${showForm ? "border-t border-rule pt-4" : ""}`} data-testid="import-summary">
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

function MemberList({ refreshKey, initial }: { refreshKey: number; initial: MemberPage }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(initial);
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
        })
        .catch((err) => {
          if (err.name !== "AbortError") setLoadError(err.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
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
    { key: "mobile", header: "Mobile", nowrap: true, cell: (m) => <span className="text-muted">{m.mobile ?? "—"}</span> },
    { key: "gender", header: "Gender", cell: (m) => <GenderBadge gender={m.gender} /> },
    { key: "center", header: "Center", cell: (m) => <span className="text-muted">{m.center}</span> },
    { key: "source", header: "Source", cell: (m) => <SourceBadge source={m.created_source} /> },
    { key: "days", header: "Days present", align: "right", cell: (m) => <span className="font-semibold">{m.attendance_count}</span> },
    { key: "actions", header: "Actions", hideHeader: true, align: "right", nowrap: true, cell: actions },
  ];

  return (
    <Card aria-label="Member list" className="overflow-hidden">
      {/* Search first and wide, on the left. The count sits to its right, or above it on a phone. */}
      <div className="flex flex-col-reverse gap-2 border-b border-rule px-4 py-3.5 sm:flex-row sm:items-end sm:gap-4 md:px-5">
        <div className="w-full sm:w-3/4">
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
        <h2 className="min-w-0 text-base font-semibold sm:flex-1 sm:pb-2.5 sm:text-right">All members ({data.total})</h2>
      </div>

      {loadError && (
        <div className="p-4">
          <Alert tone="danger" title={loadError} action={<Button variant="secondary" size="sm" onClick={reload}>Retry</Button>} />
        </div>
      )}

      {data.members.length === 0 && (
        search ? (
          <EmptyState icon={SearchX} titleAs="p" title={`No member matches “${search}”`} description="Check the spelling or try the mobile number." />
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

      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />

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
