import type { AriaRole, ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";

const ALERT_TONES: Record<string, { box: string; icon: LucideIcon; role?: AriaRole }> = {
  danger: { box: "border-danger/25 bg-danger-soft text-danger", icon: CircleAlert, role: "alert" },
  warn: { box: "border-warn/25 bg-warn-soft text-warn", icon: TriangleAlert, role: "alert" },
  ok: { box: "border-ok/25 bg-ok-soft text-ok", icon: CircleCheck },
  info: { box: "border-brand/20 bg-brand-soft text-brand-dark", icon: Info },
};

/** A message on the page. `action` sits at the end of the row; `children` hold anything longer. */
export function Alert({
  tone,
  title,
  action,
  role,
  className = "",
  inlineAction = false,
  children,
}: {
  tone: "danger" | "warn" | "ok" | "info";
  title?: ReactNode;
  action?: ReactNode;
  /** Keep a small action, such as a time, beside the message even on phones. */
  inlineAction?: boolean;
  role?: AriaRole;
  className?: string;
  children?: ReactNode;
}) {
  const { box, icon: Icon, role: defaultRole } = ALERT_TONES[tone];
  return (
    // On phones the action drops under the message at full width, instead of squeezing it into a narrow column.
    <div role={role ?? defaultRole} className={`flex items-start gap-x-2.5 gap-y-2.5 rounded-control border px-3.5 py-3 text-sm ${inlineAction ? "" : "max-sm:flex-wrap"} ${box} ${className}`}>
      <Icon aria-hidden size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold break-words">{title}</p>}
        {children && <div className={`text-ink ${title ? "mt-1" : ""}`}>{children}</div>}
      </div>
      {action && (
        <div className={`shrink-0 self-center text-ink ${inlineAction ? "" : "max-sm:basis-full max-sm:[&>*]:w-full"}`}>{action}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  titleAs: Title = "h2",
  description,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  titleAs?: "h1" | "h2" | "p";
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <span className="mb-2 flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon aria-hidden size={26} />
      </span>
      <Title className="text-lg font-semibold">{title}</Title>
      {description && <p className="max-w-md text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-control bg-active ${className}`} />;
}
