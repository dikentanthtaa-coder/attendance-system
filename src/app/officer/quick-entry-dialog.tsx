"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CenterSelect, centerName, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { api, Button, ClientApiError, Field, inputClass, Modal } from "@/components/ui";
import { normalizeMobile, type EventSession, type Gender } from "@/lib/shared";

export type QuickEntryPrefill = { name?: string; mobile?: string; globalMemberId?: string };

type Props = {
  open: boolean;
  prefill: QuickEntryPrefill;
  event: EventSession;
  gender: Gender;
  onClose: () => void;
  onSaved: (name: string) => void;
  onEventChanged: () => void;
};

export function QuickEntryDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Quick Entry: new member">
      {/* Mounted per open, so each entry starts from a clean form. */}
      {props.open && <QuickEntryForm {...props} />}
    </Modal>
  );
}

function QuickEntryForm({ prefill, event, gender, onClose, onSaved, onEventChanged }: Props) {
  const [globalMemberId, setGlobalMemberId] = useState(prefill.globalMemberId ?? "");
  const [name, setName] = useState(prefill.name ?? "");
  const [mobile, setMobile] = useState(prefill.mobile ?? "");
  const [center, setCenter] = useState<CenterValue>(EMPTY_CENTER);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Results are stored with the number they belong to, so editing the number invalidates them automatically.
  const [duplicate, setDuplicate] = useState<{ mobile: string; matches: string[] } | null>(null);
  const [confirmedMobile, setConfirmedMobile] = useState<string | null>(null);
  const mobileRef = useRef<HTMLInputElement>(null);

  const normalized = normalizeMobile(mobile);
  const matches = duplicate && duplicate.mobile === normalized ? duplicate.matches : [];
  const needsConfirmation = matches.length > 0 && confirmedMobile !== normalized;

  useEffect(() => {
    if (!normalized) return;
    const controller = new AbortController();
    api<{ matches: string[] }>(`/api/officer/check-mobile?mobile=${normalized}`, { signal: controller.signal })
      .then((data) => setDuplicate({ mobile: normalized, matches: data.matches }))
      .catch(() => {}); // the save endpoint repeats this check, so nothing is lost if this request fails
    return () => controller.abort();
  }, [normalized]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!normalized) return setError("Enter a valid 10-digit mobile number.");
    if (!centerName(center)) return setError("Please choose a center. If you chose Other, type its name.");
    if (needsConfirmation) return;

    setBusy(true);
    try {
      const saved = await api<{ memberName: string }>("/api/officer/quick-entry", {
        json: {
          eventDay: event.event_day,
          globalMemberId,
          name,
          mobile: normalized,
          center: centerName(center),
          confirmDuplicateMobile: confirmedMobile === normalized,
        },
      });
      onSaved(saved.memberName);
    } catch (err) {
      setBusy(false);
      if (err instanceof ClientApiError && err.code === "duplicate_mobile") {
        setDuplicate({ mobile: normalized, matches: err.data.matches as string[] });
        return;
      }
      setError((err as Error).message);
      if (err instanceof ClientApiError && err.code === "event_not_active") onEventChanged();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-dark">
        Will be saved as <strong>{gender}</strong> and marked present for <strong>{event.name}</strong>.
      </p>

      <Field label="Name" htmlFor="qe-name">
        <input id="qe-name" required maxLength={120} autoFocus={!prefill.name} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Mobile Number" htmlFor="qe-mobile">
        <input
          id="qe-mobile"
          ref={mobileRef}
          required
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          className={`${inputClass} font-mono`}
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
      </Field>

      {needsConfirmation && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-warn">Aa mobile number aa member sathe already registered chhe.</p>
          <ul className="mt-1 list-inside list-disc font-medium">
            {matches.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <p className="mt-2 text-ink">Continue karvu chhe ke Cancel? Family members can share a number. Continuing adds a separate member and doesn&apos;t change the existing one.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => { setMobile(""); mobileRef.current?.focus(); }}>Cancel</Button>
            <Button onClick={() => setConfirmedMobile(normalized)}>Continue</Button>
          </div>
        </div>
      )}

      <Field label="Center" htmlFor="qe-center">
        <CenterSelect id="qe-center" value={center} onChange={setCenter} />
      </Field>

      <Field label="Global Member ID" hint="(optional)" htmlFor="qe-id">
        <input id="qe-id" maxLength={50} autoComplete="off" className={`${inputClass} font-mono`} value={globalMemberId} onChange={(e) => setGlobalMemberId(e.target.value)} />
      </Field>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button type="submit" disabled={busy || needsConfirmation}>{busy ? "Saving…" : "Save & Mark Present"}</Button>
      </div>
    </form>
  );
}
