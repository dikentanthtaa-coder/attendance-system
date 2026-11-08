"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  primary: "bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50",
  secondary: "bg-white text-ink border border-line hover:bg-canvas disabled:text-muted",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export const inputClass =
  "w-full min-h-11 rounded-lg border border-line bg-white px-3 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas";

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

const STATUS_STYLE: Record<EventStatus, { className: string; dot: string }> = {
  not_started: { className: "bg-canvas text-muted border-line", dot: "border border-muted" },
  active: { className: "bg-ok-soft text-ok border-ok/30", dot: "bg-ok" },
  ended: { className: "bg-ink/5 text-ink border-ink/20", dot: "bg-ink" },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold sm:gap-1.5 sm:px-2.5 ${style.className}`}>
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {STATUS_LABEL[status]}
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
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-white p-0 text-ink shadow-xl"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-lg text-xl text-muted hover:bg-canvas">
              ×
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
      <div className="text-sm leading-relaxed text-ink">{message}</div>
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
  if (page === 1 && !hasNext) return summary ? <p className="px-1 text-sm text-muted">{summary}</p> : null;
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
