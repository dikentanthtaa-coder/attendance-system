"use client";

import { useState } from "react";
import { Alert, Button, Field, ModalActions, TextInput } from "@/components/ui";
import { api } from "@/lib/client-api";

/** Only Admin reaches this, and every removal needs a reason. Officers can't undo attendance. */
export function RemoveAttendanceForm({
  attendanceId,
  name,
  eventName,
  onClose,
  onDone,
}: {
  attendanceId: number;
  name: string;
  eventName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/attendance/${attendanceId}/cancel`, { json: { reason } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        Remove <strong className="font-semibold">{name}</strong> from <strong className="font-semibold">{eventName}</strong>? If the event is still active, they can be marked again.
      </p>
      <Field label="Reason" htmlFor="remove-reason">
        <TextInput id="remove-reason" placeholder="e.g. Marked by mistake" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>{busy ? "Removing…" : "Remove Attendance"}</Button>
      </ModalActions>
    </div>
  );
}
