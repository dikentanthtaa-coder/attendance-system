"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Alert, Button, Card, CardHeader, ConfirmDialog, GenderBadge, Modal, ModalActions, PageHeader, PersonRow, useToast } from "@/components/ui";
import { api } from "@/lib/client-api";
import type { Gender } from "@/lib/shared";

type Officer = { id: string; username: string; display_name: string; gender_scope: Gender };
type ResetResult = { name: string; temporaryPassword: string };

export function OfficersAdmin({ initial }: { initial: { officers: Officer[] } }) {
  const toast = useToast();
  const [resetting, setResetting] = useState<Officer | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetDone, setResetDone] = useState<ResetResult | null>(null);

  async function resetPassword(officer: Officer) {
    setBusy(true);
    try {
      setResetDone(await api<ResetResult>(`/api/admin/officers/${officer.id}/reset-password`, { json: {} }));
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
      setResetting(null);
    }
  }

  return (
    <>
      <PageHeader title="Officers" description="Each account can be logged in on as many devices as you need." />

      <Card aria-label="Officer list" className="overflow-hidden">
        <CardHeader title="Officer accounts" />
        <ul className="divide-y divide-rule">
          {initial.officers.map((o) => (
            <li key={o.id}>
              <PersonRow
                name={o.display_name}
                gender={o.gender_scope}
                nameBadge={<GenderBadge gender={o.gender_scope} />}
                meta={<p className="mt-0.5 text-sm text-muted">Username: <span className="font-medium text-ink">{o.username}</span></p>}
                stackActions
                actions={<Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setResetting(o)}>Reset password</Button>}
              />
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={resetting !== null}
        title="Reset password"
        busy={busy}
        confirmLabel="Reset Password"
        onConfirm={() => resetting && resetPassword(resetting)}
        onCancel={() => setResetting(null)}
        message={
          resetting && (
            <>
              The current password for <strong className="font-semibold">{resetting.display_name}</strong> will stop working, and <strong className="font-semibold">every device</strong> on this account will be logged out and need the new password.
            </>
          )
        }
      />

      <Modal open={resetDone !== null} onClose={() => setResetDone(null)} title="Temporary password">
        {resetDone && <TemporaryPassword result={resetDone} onClose={() => setResetDone(null)} />}
      </Modal>
    </>
  );
}

/** Shown once: only a hash is stored, so if it's lost, Admin just resets again. */
function TemporaryPassword({ result, onClose }: { result: ResetResult; onClose: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        Use this to log in to <strong className="font-semibold">{result.name}</strong>. The first login then chooses a new password, which every other device needs too.
      </p>
      <p data-testid="temporary-password" className="rounded-control bg-canvas px-4 py-3 text-center text-xl font-bold tracking-wide break-all select-all">
        {result.temporaryPassword}
      </p>
      <Alert tone="info" title="This is the only time it will be shown.">
        If it gets lost, reset the password again.
      </Alert>
      {copied === "failed" && <Alert tone="warn" role="status" title="Couldn't copy automatically. Please select it and copy it yourself." />}
      <ModalActions>
        <Button variant="secondary" icon={copied === "yes" ? Check : Copy} onClick={copy}>{copied === "yes" ? "Copied" : "Copy"}</Button>
        <Button onClick={onClose}>Done</Button>
      </ModalActions>
    </div>
  );
}
