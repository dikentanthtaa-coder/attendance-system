"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CenterSelect, centerName, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { api, Button, ClientApiError, ErrorNote, Field, inputClass } from "@/components/ui";
import { normalizeMobile, type EventSession, type Gender } from "@/lib/shared";

export type QuickEntryPrefill = { name?: string; mobile?: string; globalMemberId?: string };

/** On the page rather than in a pop-up: nothing clips the center list and the phone's back gesture stays simple. */
export function QuickEntryPanel({
  prefill,
  event,
  gender,
  onCancel,
  onSaved,
  onEventChanged,
}: {
  prefill: QuickEntryPrefill;
  event: EventSession;
  gender: Gender;
  onCancel: () => void;
  onSaved: (name: string, markedAt: string) => void;
  onEventChanged: () => void;
}) {
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
      const saved = await api<{ memberName: string; markedAt: string }>("/api/officer/quick-entry", {
        json: {
          eventDay: event.event_day,
          globalMemberId,
          name,
          mobile: normalized,
          center: centerName(center),
          confirmDuplicateMobile: confirmedMobile === normalized,
        },
      });
      onSaved(saved.memberName, saved.markedAt);
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
    <section aria-label="Quick Entry" className="rounded-card border border-line bg-white p-4">
      <h2 className="text-base font-semibold">Quick Entry: new member</h2>
      <p className="mt-0.5 mb-4 text-muted">
        Will be saved as <strong className="font-semibold text-ink">{gender}</strong> and marked present for <strong className="font-semibold text-ink">{event.name}</strong>.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
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
            autoFocus={Boolean(prefill.name)}
            className={inputClass}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </Field>

        {needsConfirmation && (
          <div role="alert" className="rounded-control bg-warn-soft p-3 text-sm">
            <p className="font-semibold text-warn">Aa mobile number aa member sathe already registered chhe.</p>
            <ul className="mt-1 font-semibold">
              {matches.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <p className="mt-2">Continue karvu chhe ke Cancel? Family members can share a number. Continuing adds a separate member and doesn&apos;t change the existing one.</p>
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
          <input id="qe-id" maxLength={50} autoComplete="off" className={inputClass} value={globalMemberId} onChange={(e) => setGlobalMemberId(e.target.value)} />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || needsConfirmation}>{busy ? "Saving…" : "Save & Mark Present"}</Button>
          <Button variant="secondary" onClick={onCancel}>Back to search</Button>
        </div>
      </form>
    </section>
  );
}
