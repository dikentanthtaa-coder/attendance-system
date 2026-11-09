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
    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted">
      {items.filter((item): item is MetaItem => Boolean(item)).map(({ icon: Icon, label, strong }, i) => (
        <span key={i} className={`inline-flex items-center gap-1 ${strong ? "font-semibold text-ink" : ""}`}>
          <Icon aria-hidden size={13} className="shrink-0" />
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
  actionsBelowOnPhone,
  hideAvatarOnPhone,
}: {
  name: string;
  gender?: Gender;
  meta: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  /** For two or more large buttons, which would squeeze the name on a phone. */
  actionsBelowOnPhone?: boolean;
  hideAvatarOnPhone?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${actionsBelowOnPhone ? "flex-wrap sm:flex-nowrap" : ""}`}>
      <Avatar name={name} gender={gender} className={`self-start ${hideAvatarOnPhone ? "hidden sm:flex" : ""}`} />
      <div className={`min-w-0 flex-1 ${actionsBelowOnPhone ? "basis-3/5" : ""}`}>
        <p className="text-base font-semibold break-words">{name}</p>
        {meta}
        {footer && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{footer}</div>}
      </div>
      {actions && <div className={`flex shrink-0 items-center ${actionsBelowOnPhone ? "w-full gap-2 sm:w-auto [&>button]:flex-1" : "gap-1"}`}>{actions}</div>}
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
