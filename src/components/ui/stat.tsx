import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const STAT_TONES = {
  hero: { box: "border-transparent bg-brand-deep text-white", label: "text-white/85", note: "text-white/85" },
  male: { box: "border-transparent bg-male-soft", label: "text-male-ink", note: "text-muted" },
  female: { box: "border-transparent bg-female-soft", label: "text-female-ink", note: "text-muted" },
  warn: { box: "border-transparent bg-warn-soft", label: "text-warn", note: "text-muted" },
  danger: { box: "border-transparent bg-danger-soft", label: "text-danger", note: "text-muted" },
  neutral: { box: "border-line bg-white", label: "text-muted", note: "text-muted" },
} as const;

export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "neutral",
  testId,
  className = "",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  testId?: string;
  className?: string;
}) {
  const look = STAT_TONES[tone];
  return (
    <div className={`rounded-card border p-4 shadow-card ${look.box} ${className}`}>
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${look.label}`}>
        <Icon aria-hidden size={16} className="shrink-0" />
        {label}
      </p>
      <p className={`mt-1 font-bold tracking-tight ${tone === "hero" ? "text-4xl leading-11" : "text-3xl leading-10"}`} data-testid={testId}>{value}</p>
      {note && <p className={`text-xs ${look.note}`}>{note}</p>}
    </div>
  );
}

/** Small labelled figures that belong together, such as an upload result. */
export function StatList({ items }: { items: { label: string; value: ReactNode; tone?: "danger" | "ok" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`rounded-control px-3 py-2.5 ${item.tone === "danger" ? "bg-danger-soft" : item.tone === "ok" ? "bg-ok-soft" : "bg-canvas"}`}>
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="text-2xl leading-8 font-bold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
