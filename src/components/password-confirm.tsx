"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Alert, Button, Field, Modal, ModalActions, PasswordInput } from "@/components/ui";

/**
 * For actions that can't be undone: Admin types their login password again. `onConfirm` throws to
 * show its message here and keep the dialog open, e.g. for a wrong password.
 */
export function PasswordConfirm({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  icon,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  icon?: LucideIcon;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      {open && <Form confirmLabel={confirmLabel} busyLabel={busyLabel} icon={icon} onConfirm={onConfirm} onCancel={onCancel}>{children}</Form>}
    </Modal>
  );
}

function Form({
  children,
  confirmLabel,
  busyLabel,
  icon,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  icon?: LucideIcon;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return setError("Please enter your Admin password.");
    setBusy(true);
    setError("");
    try {
      await onConfirm(password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 text-sm">{children}</div>
      <Field label="Admin password" hint="the one you log in with" htmlFor="confirm-password">
        <PasswordInput
          id="confirm-password"
          placeholder="Your login password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
        />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="danger" icon={icon} loading={busy}>{busy ? busyLabel : confirmLabel}</Button>
      </ModalActions>
    </form>
  );
}
