"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, X } from "lucide-react";
import { STATUS_LABEL, type EventStatus } from "@/lib/shared";

export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Fetch wrapper: JSON in and out, typed errors, and a redirect when the session has expired. */
export async function api<T>(url: string, options: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? (options.json !== undefined || options.body ? "POST" : "GET"),
      headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ClientApiError(0, "network", "No connection. Check the internet and try again.", {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A full page load on purpose: it discards all in-memory state from the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && data.code === "unauthenticated") window.location.assign("/login");
    throw new ClientApiError(res.status, data.code ?? "error", data.message ?? "Something went wrong.", data);
  }
  return data as T;
}

const BUTTON_VARIANTS = {
  primary: "bg-brand text-white hover:bg-brand-dark active:bg-ink disabled:bg-active disabled:text-muted",
  secondary: "bg-white text-ink border border-control hover:border-muted hover:bg-canvas active:bg-active disabled:text-muted disabled:bg-canvas",
  outline: "bg-white text-brand border border-brand/60 hover:border-brand hover:bg-brand-soft active:bg-active disabled:text-muted disabled:border-control",
  danger: "bg-danger text-white hover:bg-danger/90 active:bg-ink disabled:bg-active disabled:text-muted",
  "danger-outline": "bg-white text-danger border border-danger/60 hover:border-danger hover:bg-danger-soft active:bg-danger-soft",
  ghost: "text-muted hover:bg-active hover:text-ink active:bg-control/40",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

const ROW_ACTION_TONES = {
  brand: "text-brand hover:bg-brand-soft",
  // Corrections are rare, so red only appears on hover rather than down every row.
  quiet: "text-muted hover:bg-danger-soft hover:text-danger",
};

/** A small action inside a table row or list row. */
export function RowAction({ tone, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone: keyof typeof ROW_ACTION_TONES }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-control px-2.5 text-sm font-semibold transition-colors duration-150 lg:min-h-8 ${ROW_ACTION_TONES[tone]} ${className}`}
    />
  );
}

/** 16px while typing, so phones don't zoom the page when the field takes focus. */
export const inputClass =
  "w-full min-h-11 rounded-control border border-control bg-white px-3 text-base text-ink placeholder:text-muted hover:border-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas";

export const selectClass = `${inputClass} md:text-sm`;

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
}

/** The app's mark: three strokes for the three days. */
export function Mark() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--color-brand)" />
      <path d="M9 10v12M16 10v12M23 10v12" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/** Event status as an icon and a word, so it never relies on colour alone. */
export function StatusLabel({ status }: { status: EventStatus }) {
  const label = STATUS_LABEL[status];
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-ok">
        <Circle aria-hidden size={10} className="fill-ok" />
        {label}
      </span>
    );
  }
  if (status === "ended") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink">
        <Check aria-hidden size={13} strokeWidth={2.5} />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
      <Circle aria-hidden size={10} />
      {label}
    </span>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-label={title} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-white p-0 text-ink shadow-xl">
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-rule py-1.5 pr-1.5 pl-5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-ink">
              <X aria-hidden size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="text-sm leading-relaxed">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
          {busy ? "Please wait…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="px-3"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}

export function Pagination({ page, hasNext, onPage, summary }: { page: number; hasNext: boolean; onPage: (page: number) => void; summary?: string }) {
  if (page === 1 && !hasNext) return summary ? <p className="text-sm text-muted">{summary}</p> : null;
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted">{summary ?? `Page ${page}`}</p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={!hasNext} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
