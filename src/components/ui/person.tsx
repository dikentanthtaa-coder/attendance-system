import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Gender } from "@/lib/shared";

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  const first = Array.from(parts[0] ?? "")[0] ?? "?";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "";
  return `${first}${last}`.toUpperCase();
};

export function Avatar({ name, gender, className = "" }: { name: string; gender?: Gender; className?: string }) {
  const tone = gender === "Male" ? "bg-male-soft text-male-ink" : gender === "Female" ? "bg-female-soft text-female-ink" : "bg-active text-ink";
  return (
    <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone} ${className}`}>
      {initials(name)}
    </span>
  );
}

export type MetaItem = { icon: LucideIcon; label: ReactNode; strong?: boolean };

/** Short facts about a person or record, each with its own icon. Empty values are left out. */
export function MetaList({ items }: { items: (MetaItem | null | undefined | false)[] }) {
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted sm:gap-x-3 sm:text-sm">
      {items.filter((item): item is MetaItem => Boolean(item)).map(({ icon: Icon, label, strong }, i) => (
        <span key={i} className={`inline-flex items-center gap-1 ${strong ? "font-semibold text-ink" : ""}`}>
          {/* Plain text on phones, so an ID and a number fit on one line beside the button. */}
          <Icon aria-hidden size={13} className="shrink-0 max-sm:hidden" />
          {label}
        </span>
      ))}
    </p>
  );
}

/** A person as one list row. Used wherever a table doesn't fit: search results and every phone list. */
export function PersonRow({
  name,
  gender,
  meta,
  footer,
  actions,
  nameBadge,
  hideAvatarOnPhone,
  stackActions,
}: {
  name: string;
  gender?: Gender;
  meta: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  /** Sits beside the name, so a row stays compact. */
  nameBadge?: ReactNode;
  hideAvatarOnPhone?: boolean;
  /** Phones: the actions go on their own line under the details, so a long name isn't squeezed. */
  stackActions?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 sm:py-3 ${stackActions ? "max-sm:flex-wrap" : ""}`}>
      <Avatar name={name} gender={gender} className={`self-start ${hideAvatarOnPhone ? "hidden sm:flex" : ""}`} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug font-semibold break-words sm:text-base">
          {name}
          {nameBadge}
        </p>
        {meta}
        {footer && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{footer}</div>}
      </div>
      {actions && <div className={`flex shrink-0 items-center gap-1 ${stackActions ? "max-sm:basis-full max-sm:pl-12" : ""}`}>{actions}</div>}
    </div>
  );
}

/** Avatar and name for the first column of a table. */
export function PersonCell({ name, gender, detail }: { name: string; gender?: Gender; detail?: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <Avatar name={name} gender={gender} />
      <span className="min-w-0">
        <span className="block font-semibold">{name}</span>
        {detail && <span className="block text-xs whitespace-nowrap text-muted">{detail}</span>}
      </span>
    </span>
  );
}
