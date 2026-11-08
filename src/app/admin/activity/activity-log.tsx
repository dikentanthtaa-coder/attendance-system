"use client";

import { useEffect, useState } from "react";
import { api, Pagination } from "@/components/ui";
import { formatDateTime } from "@/lib/shared";

type Entry = {
  id: string;
  at: string;
  username: string;
  action: string;
  entity_id: string | null;
  details: Record<string, unknown>;
};

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Logged in",
  "event.start": "Started event",
  "event.end": "Ended event",
  "event.restart": "Restarted event",
  "attendance.mark": "Marked attendance",
  "attendance.cancel": "Removed attendance",
  "member.quick_entry": "Quick Entry",
  "member.edit": "Edited member",
  "member.delete": "Deleted member",
  "members.excel_upload": "Excel upload",
};

function describe(entry: Entry): string {
  const d = entry.details as Record<string, never>;
  switch (entry.action) {
    case "event.start":
    case "event.end":
    case "event.restart":
      return d.name;
    case "attendance.mark":
      return `${d.member_name}, Day ${d.event_day}`;
    case "attendance.cancel":
      return `${d.member_name}, Day ${d.event_day}. Reason: ${d.reason}`;
    case "member.quick_entry":
      return `${d.name}, ${d.gender}, ${d.center}, Day ${d.event_day}${d.duplicate_mobile_confirmed ? " (shared mobile confirmed)" : ""}`;
    case "member.edit":
      return (d.after as { name: string }).name;
    case "member.delete":
      return (d.member as { name: string }).name;
    case "members.excel_upload":
      return `${d.file_name}: ${d.total_rows} rows, ${d.imported} new, ${d.updated} updated, ${d.error_rows} errors`;
    default:
      return "";
  }
}

export function ActivityLog() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: Entry[]; hasMore: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<{ entries: Entry[]; hasMore: boolean }>(`/api/admin/audit?page=${page}`, { signal: controller.signal })
      .then(setData)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [page]);

  return (
    <>
      <h1 className="text-xl font-bold">Activity Log</h1>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Time</th>
                <th scope="col" className="py-2 pr-3 font-medium">User</th>
                <th scope="col" className="py-2 pr-3 font-medium">Activity</th>
                <th scope="col" className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(entry.at)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{entry.username}</td>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td className="py-2">{describe(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pagination page={page} hasNext={data.hasMore} onPage={setPage} />}
      </section>
    </>
  );
}
