"use client";

import { useEffect, useState } from "react";
import { api, ErrorNote, Pagination } from "@/components/ui";
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
      <h1 className="text-2xl font-semibold">Activity Log</h1>
      {error && <ErrorNote>{error}</ErrorNote>}
      <section aria-label="Activity" className="rounded-card border border-line bg-white">
        {data && data.entries.length === 0 && <p className="p-4 text-muted">Nothing has happened yet. Logins, uploads, event changes and attendance appear here.</p>}

        <ul className="divide-y divide-rule lg:hidden">
          {data?.entries.map((entry) => (
            <li key={entry.id} className="px-4 py-2.5">
              <p className="font-semibold">{ACTION_LABEL[entry.action] ?? entry.action}</p>
              {describe(entry) && <p className="break-words">{describe(entry)}</p>}
              <p className="text-muted">{formatDateTime(entry.at)}, {entry.username}</p>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 pl-4 font-normal">Time</th>
                <th scope="col" className="py-2 pr-3 font-normal">User</th>
                <th scope="col" className="py-2 pr-3 font-normal">Activity</th>
                <th scope="col" className="py-2 pr-4 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((entry) => (
                <tr key={entry.id} className="border-t border-rule align-top">
                  <td className="py-2 pr-3 pl-4 whitespace-nowrap text-muted">{formatDateTime(entry.at)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">{entry.username}</td>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td className="py-2 pr-4">{describe(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && (page > 1 || data.hasMore) && (
          <div className="border-t border-rule p-4">
            <Pagination page={page} hasNext={data.hasMore} onPage={setPage} />
          </div>
        )}
      </section>
    </>
  );
}
