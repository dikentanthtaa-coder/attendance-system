"use client";

import { useState } from "react";
import { ChartColumn, Inbox, Table2 } from "lucide-react";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/shared";

export type DayRow = { eventDay: number; eventName: string; date: string; male: number; female: number; total: number };

type SeriesKey = "male" | "female";

/** Fixed order and fixed colours, so a filter that hides one never repaints the other. */
const SERIES: { key: SeriesKey; label: string; fill: string; key_: string }[] = [
  { key: "male", label: "Male", fill: "bg-male", key_: "bg-male" },
  { key: "female", label: "Female", fill: "bg-female", key_: "bg-female" },
];

/** Whole-number ticks from 0 to a round top that's at least the largest value: 0 5 10 15 20. */
function scale(max: number) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow);
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

const shortDay = (r: DayRow) => r.eventName.replace("Gyansatra ", "");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Present people each day as columns, male and female side by side with the day's total above, and
 * the male/female share of everyone present as one bar. Hover or focus a column for its number;
 * "Show table" gives every number as plain text.
 */
export function DayChart({ rows, male, female, total, gender }: { rows: DayRow[]; male: number; female: number; total: number; gender: string }) {
  const [asTable, setAsTable] = useState(false);
  const series = SERIES.filter((s) => gender === "all" || s.label === gender);
  const both = series.length === 2;

  return (
    <Card aria-label="Event day-wise attendance" className="overflow-hidden">
      <CardHeader
        title="By event day and date"
        description={both ? "People present each day, male and female." : `${gender} people present each day.`}
        actions={
          rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {both && <Legend />}
              <Button variant="ghost" size="sm" icon={asTable ? ChartColumn : Table2} aria-pressed={asTable} onClick={() => setAsTable((t) => !t)}>
                {asTable ? "Show chart" : "Show table"}
              </Button>
            </div>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Inbox} titleAs="p" title="No attendance yet" description="Numbers appear here as officers mark people present." />
      ) : asTable ? (
        <DayTable rows={rows} />
      ) : (
        <div className={`grid gap-6 p-4 md:p-5 ${both && total > 0 ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8" : ""}`}>
          {both && total > 0 && <Split male={male} female={female} total={total} />}
          <Columns rows={rows} series={series} />
        </div>
      )}
    </Card>
  );
}

function Legend() {
  return (
    <ul className="flex gap-3 text-sm text-muted" aria-label="Legend">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-[3px] ${s.key_}`} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** One whole, split in two: the share of everyone present who is male and female. */
function Split({ male, female, total }: { male: number; female: number; total: number }) {
  const parts = [
    { ...SERIES[0], value: male },
    { ...SERIES[1], value: female },
  ].filter((p) => p.value > 0);
  return (
    <section aria-label="Male and female share" className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Male and female share</h3>
        <p className="text-sm text-muted">Of {total} present, across the days in these filters.</p>
      </div>
      <div className="flex h-7 gap-0.5" role="img" aria-label={`${pct(male, total)}% male (${male}), ${pct(female, total)}% female (${female})`}>
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${p.value} (${pct(p.value, total)}%)`}
            className={`flex min-w-1 items-center rounded-[4px] px-2 text-xs font-semibold text-white ${p.fill}`}
            style={{ flexGrow: p.value, flexBasis: 0 }}
          >
            {/* Printed only where it fits; the figures below always carry it. */}
            {pct(p.value, total) >= 14 && `${pct(p.value, total)}%`}
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {SERIES.map((s, i) => {
          const value = i === 0 ? male : female;
          return (
            <div key={s.key} className="rounded-control border border-rule px-3 py-2">
              <dt className="flex items-center gap-1.5 text-sm text-muted">
                <span aria-hidden className={`h-0.5 w-3 rounded-full ${s.key_}`} />
                {s.label}
              </dt>
              <dd className="text-xl font-bold">
                {value} <span className="text-sm font-semibold text-muted">{pct(value, total)}%</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Columns({ rows, series }: { rows: DayRow[]; series: typeof SERIES }) {
  const [active, setActive] = useState<string | null>(null);
  const { top, ticks } = scale(Math.max(...rows.map((r) => Math.max(...series.map((s) => r[s.key])))));
  const height = (v: number) => `${(v / top) * 100}%`;

  return (
    <section aria-label="Present each day" className="min-w-0">
      <h3 className="sr-only">Present each day</h3>
      {/* Room above the plot for the top scale number, the day totals and the hover label. Nothing
          here scrolls or clips: with many days the columns narrow instead. */}
      <div className="pt-6">
        <div className="flex">
          {/* Y axis: clean whole numbers, in muted text. */}
          <div aria-hidden className="relative mr-2 h-56 w-8 shrink-0 text-right text-xs text-muted tabular-nums sm:h-64">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: height(t) }}>{t}</span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative h-56 border-b border-line sm:h-64">
              {ticks.slice(1).map((t) => (
                <div key={t} aria-hidden className="absolute inset-x-0 border-t border-rule" style={{ bottom: height(t) }} />
              ))}
              <ul className="absolute inset-0 flex">
                {rows.map((r, band) => {
                  const tallest = Math.max(...series.map((s) => r[s.key]));
                  const dayTotal = series.reduce((sum, s) => sum + r[s.key], 0);
                  // Near the edges the tooltip opens inward, so the card never cuts it off.
                  const align = band === 0 ? "left-0" : band === rows.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
                  return (
                    <li key={`${r.eventDay}-${r.date}`} className="relative flex min-w-0 flex-1 items-end justify-center gap-0.5 px-0.5">
                      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-sm font-semibold whitespace-nowrap" style={{ bottom: `calc(${height(tallest)} + 0.25rem)` }}>
                        {dayTotal}
                        {series.length > 1 && <span className="font-normal text-muted"> total</span>}
                      </span>
                      {series.map((s) => {
                        const id = `${r.eventDay}-${r.date}-${s.key}`;
                        const value = r[s.key];
                        const on = active === id;
                        return (
                          // The whole column slot, not just the painted bar, answers hover and focus.
                          <button
                            key={s.key}
                            type="button"
                            aria-label={`${shortDay(r)}, ${formatDate(r.date)}: ${value} ${s.label.toLowerCase()}`}
                            className="group relative flex h-full w-7 min-w-0 shrink items-end justify-center rounded-t-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:w-8"
                            onPointerEnter={() => setActive(id)}
                            onPointerLeave={() => setActive((a) => (a === id ? null : a))}
                            onFocus={() => setActive(id)}
                            onBlur={() => setActive((a) => (a === id ? null : a))}
                            onClick={() => setActive((a) => (a === id ? null : id))}
                          >
                            <span
                              aria-hidden
                              className={`block w-full max-w-6 rounded-t-[4px] transition-[height,opacity] duration-300 motion-reduce:transition-none ${s.fill} ${on ? "opacity-80" : ""}`}
                              style={{ height: value > 0 ? height(value) : "0" }}
                            />
                            {on && (
                              <span
                                role="tooltip"
                                className={`pointer-events-none absolute z-10 flex flex-col rounded-control bg-ink px-2.5 py-1.5 text-left whitespace-nowrap text-white shadow-lg ${align}`}
                                style={{ bottom: `calc(${height(tallest)} + 1.75rem)` }}
                              >
                                <span className="text-base leading-5 font-bold">{value}</span>
                                <span className="flex items-center gap-1.5 text-xs text-white/80">
                                  <span aria-hidden className={`h-0.5 w-3 rounded-full ${s.key_}`} />
                                  {s.label} · {shortDay(r)}
                                </span>
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </div>
            {/* X axis: the day, and the date under it. */}
            <div className="flex pt-2">
              {rows.map((r) => (
                <div key={`${r.eventDay}-${r.date}`} className="flex-1 text-center">
                  <span className="block text-sm font-semibold">{shortDay(r)}</span>
                  <span className="block text-xs text-muted">{formatDate(r.date)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DayTable({ rows }: { rows: DayRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-canvas text-left text-xs text-muted">
          <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold md:pl-5">Event</th>
          <th scope="col" className="py-2.5 pr-3 text-right font-semibold">Male</th>
          <th scope="col" className="py-2.5 pr-3 text-right font-semibold">Female</th>
          <th scope="col" className="py-2.5 pr-4 text-right font-semibold md:pr-5">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.eventDay}-${r.date}`} className="border-t border-rule tabular-nums">
            <td className="py-2.5 pr-3 pl-4 md:pl-5">
              <span className="block font-semibold whitespace-nowrap">{r.eventName}</span>
              <span className="block text-xs whitespace-nowrap text-muted">{formatDate(r.date)}</span>
            </td>
            <td className="py-2.5 pr-3 text-right">{r.male}</td>
            <td className="py-2.5 pr-3 text-right">{r.female}</td>
            <td className="py-2.5 pr-4 text-right font-bold md:pr-5">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
