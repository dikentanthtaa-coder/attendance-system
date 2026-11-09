import type { ReactNode } from "react";
import { Check, Circle, ClipboardList, CircleDot, UserPlus, type LucideIcon } from "lucide-react";
import { SOURCE_LABEL, STATUS_LABEL, type DayCell, type EventStatus, type Gender, type MemberSource } from "@/lib/shared";

const TONES = {
  neutral: "bg-active text-ink",
  brand: "bg-brand-soft text-brand-dark",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  male: "bg-male-soft text-male-ink",
  female: "bg-female-soft text-female-ink",
} as const;

export type BadgeTone = keyof typeof TONES;

/** `compact` is for tight spaces on a phone: plain coloured words, on one line and all the same height. */
export function Badge({ tone = "neutral", icon: Icon, compact, children }: { tone?: BadgeTone; icon?: LucideIcon; compact?: boolean; children: ReactNode }) {
  const fit = compact ? "whitespace-nowrap max-sm:bg-transparent max-sm:p-0 max-sm:text-[11px] sm:px-2.5" : "px-2.5 whitespace-nowrap";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full py-0.5 text-xs font-semibold ${fit} ${TONES[tone]}`}>
      {Icon && <Icon aria-hidden size={12} strokeWidth={2.5} className={`shrink-0 ${compact ? "hidden sm:block" : ""}`} />}
      {children}
    </span>
  );
}

/** The word is always shown, so status never relies on colour alone. */
const STATUS_LOOK: Record<EventStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  active: { tone: "ok", icon: CircleDot },
  ended: { tone: "brand", icon: Check },
  not_started: { tone: "neutral", icon: Circle },
};

export function StatusBadge({ status, compact }: { status: EventStatus; compact?: boolean }) {
  const { tone, icon } = STATUS_LOOK[status];
  return <Badge tone={tone} icon={icon} compact={compact}>{STATUS_LABEL[status]}</Badge>;
}

const DAY_CELL_LOOK: Record<DayCell, { className: string; label: string }> = {
  P: { className: "bg-ok text-white", label: "Present" },
  A: { className: "bg-danger text-white", label: "Absent" },
  "-": { className: "bg-active text-muted", label: "Not marked yet" },
};

/** P or A as one strong letter, easy to scan down a column. The full word is there for screen readers. */
export function DayCellBadge({ value }: { value: DayCell }) {
  const { className, label } = DAY_CELL_LOOK[value];
  return <span title={label} aria-label={label} className={`inline-flex size-6 items-center justify-center rounded-md text-xs font-bold ${className}`}>{value}</span>;
}

export function GenderBadge({ gender }: { gender: Gender }) {
  return <Badge tone={gender === "Male" ? "male" : "female"}>{gender}</Badge>;
}

export function SourceBadge({ source }: { source: MemberSource }) {
  return source === "quick_entry"
    ? <Badge tone="warn" icon={UserPlus}>{SOURCE_LABEL[source]}</Badge>
    : <Badge icon={ClipboardList}>{SOURCE_LABEL[source]}</Badge>;
}
