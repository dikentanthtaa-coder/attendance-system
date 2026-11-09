import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const STAT_TONES = {
  hero: { box: "border-transparent bg-brand-deep text-white", label: "text-white/85", note: "text-white/85", rule: "border-white/20" },
  male: { box: "border-transparent bg-male-soft", label: "text-male-ink", note: "text-muted", rule: "border-male-ink/15" },
  female: { box: "border-transparent bg-female-soft", label: "text-female-ink", note: "text-muted", rule: "border-female-ink/15" },
  warn: { box: "border-transparent bg-warn-soft", label: "text-warn", note: "text-muted", rule: "border-warn/20" },
  neutral: { box: "border-line bg-white", label: "text-muted", note: "text-muted", rule: "border-line" },
} as const;

export function StatCard({
  label,
  value,
  note,
  secondary,
  icon: Icon,
  tone = "neutral",
  testId,
  className = "",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** A second figure under the first, such as how many of a total are present. */
  secondary?: { label: string; value: ReactNode; testId?: string };
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
      {secondary && (
        <p className={`mt-2 flex items-baseline gap-2 border-t pt-2 ${look.rule}`}>
          <span className="text-2xl leading-8 font-bold tracking-tight tabular-nums" data-testid={secondary.testId}>{secondary.value}</span>
          <span className={`text-sm font-semibold ${look.label}`}>{secondary.label}</span>
        </p>
      )}
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
