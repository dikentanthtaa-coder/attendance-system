"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast";
import { api, Button, ConfirmDialog, Field, inputClass, Modal, Pagination } from "@/components/ui";
import { CENTERS, SOURCE_LABEL, type Gender, type MemberSource } from "@/lib/shared";

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

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function MembersAdmin() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <h1 className="text-xl font-bold">Members</h1>
      <UploadCard onImported={() => setRefreshKey((k) => k + 1)} />
      <MemberList refreshKey={refreshKey} />
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
    <section aria-label="Excel upload" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
      <div>
        <h2 className="text-base font-semibold">Upload member Excel</h2>
        <p className="text-sm text-muted">
          The first row must have these columns: <span className="font-medium text-ink">No, MemberID, Name, Mo.no., Gender, Center</span>. Uploading a MemberID that already exists updates that member.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-canvas focus-within:outline-2 focus-within:outline-brand">
          Choose file
          <input
            ref={fileRef}
            type="file"
            aria-label="Excel file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? "");
              setError("");
            }}
          />
        </label>
        <span className="min-w-0 truncate text-sm text-muted">{fileName || "No file chosen"}</span>
        <Button type="submit" disabled={busy || !fileName}>{busy ? "Uploading…" : "Upload"}</Button>
      </form>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {summary && (
        <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="import-summary">
          <p className="text-sm font-semibold">Upload result: {summary.fileName}</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Total rows", summary.totalRows],
              ["New members", summary.imported],
              ["Updated", summary.updated],
              ["Rows with errors", summary.errorRows],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-2xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {summary.errors.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm text-muted">These rows were not imported. Correct them in the file and upload it again.</p>
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">Row</th>
                    <th scope="col" className="py-2 pr-3 font-medium">MemberID</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.errors.map((row) => (
                    <tr key={row.row} className="border-b border-line/60 align-top">
                      <td className="py-2 pr-3 tabular-nums">{row.row}</td>
                      <td className="py-2 pr-3 font-mono">{row.memberId || "—"}</td>
                      <td className="py-2 pr-3">{row.name || "—"}</td>
                      <td className="py-2 text-danger">{row.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MemberList({ refreshKey }: { refreshKey: number }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ members: Member[]; total: number; pageSize: number } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ members: Member[]; total: number; pageSize: number }>(
        `/api/admin/members?q=${encodeURIComponent(search)}&page=${page}`,
        { signal: controller.signal },
      )
        .then(setData)
        .catch((err) => {
          if (err.name !== "AbortError") toast("error", err.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, page, refreshKey, reloadKey, toast]);

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

  return (
    <section aria-label="Member list" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">All members{data ? ` (${data.total})` : ""}</h2>
        <input
          type="search"
          aria-label="Search members"
          placeholder="Member ID, name or mobile"
          className={`${inputClass} sm:max-w-xs`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {data && data.members.length === 0 && <p className="py-6 text-center text-sm text-muted">No members found.</p>}

      {data && data.members.length > 0 && (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                {["Member ID", "Name", "Mobile", "Gender", "Center", "Source", "Days present"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                ))}
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">{m.global_member_id ?? "—"}</td>
                  <td className="py-2 pr-3 font-medium">{m.name}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">{m.mobile}</td>
                  <td className="py-2 pr-3">{m.gender}</td>
                  <td className="py-2 pr-3">{m.center}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{SOURCE_LABEL[m.created_source]}</td>
                  <td className="py-2 pr-3 tabular-nums">{m.attendance_count}</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setEditing(m)} className="min-h-9 rounded-md px-2 text-xs font-semibold text-brand hover:bg-brand-soft">Edit</button>
                    <button type="button" onClick={() => setDeleting(m)} className="min-h-9 rounded-md px-2 text-xs font-semibold text-danger hover:bg-danger-soft">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <Pagination
          page={page}
          hasNext={page * data.pageSize < data.total}
          onPage={setPage}
          summary={data.total > 0 ? `Showing ${(page - 1) * data.pageSize + 1}–${Math.min(page * data.pageSize, data.total)} of ${data.total}` : undefined}
        />
      )}

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
              Delete <strong>{deleting.name}</strong>?
              {deleting.attendance_count > 0 && (
                <> Their attendance for <strong>{deleting.attendance_count} day(s)</strong> will be removed from reports too.</>
              )}{" "}
              A copy is kept in the Activity Log.
            </>
          )
        }
      />
    </section>
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
        <input id="edit-name" required maxLength={120} className={inputClass} value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Mobile Number" htmlFor="edit-mobile">
        <input id="edit-mobile" required type="tel" className={`${inputClass} font-mono`} value={form.mobile} onChange={set("mobile")} />
      </Field>
      <Field label="Gender" htmlFor="edit-gender">
        <select id="edit-gender" className={inputClass} value={form.gender} onChange={set("gender")}>
          <option>Male</option>
          <option>Female</option>
        </select>
      </Field>
      <Field label="Center" htmlFor="edit-center">
        <input id="edit-center" required maxLength={80} list="edit-center-list" autoComplete="off" className={inputClass} value={form.center} onChange={set("center")} />
        <datalist id="edit-center-list">
          {CENTERS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="Global Member ID" hint="(optional)" htmlFor="edit-id">
        <input id="edit-id" maxLength={50} autoComplete="off" className={`${inputClass} font-mono`} value={form.globalMemberId} onChange={set("globalMemberId")} />
      </Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
