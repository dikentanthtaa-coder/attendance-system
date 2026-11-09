import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** For a column of buttons: read aloud, but no visible heading. */
  hideHeader?: boolean;
  nowrap?: boolean;
};

/**
 * One data set, two layouts: a table on large screens, and a list on phones and tablets so
 * nothing scrolls sideways. Every field a table shows must also appear in `mobileRow`.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  mobileRow,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  mobileRow: (row: T) => ReactNode;
}) {
  return (
    <>
      <ul className="divide-y divide-rule lg:hidden">
        {rows.map((row) => <li key={rowKey(row)}>{mobileRow(row)}</li>)}
      </ul>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs font-semibold text-muted">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-label={column.hideHeader ? column.header : undefined}
                  className={`px-3 py-2.5 font-semibold whitespace-nowrap first:pl-5 last:pr-5 ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.hideHeader ? null : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-rule transition-colors duration-150 hover:bg-canvas/70">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 first:pl-5 last:pr-5 ${column.align === "right" ? "text-right" : ""} ${column.nowrap ? "whitespace-nowrap" : ""}`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
