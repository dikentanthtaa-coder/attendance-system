"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CircleCheck, Phone, UserRound } from "lucide-react";
import { CenterSelect, centerName, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { Alert, Button, Card, CardHeader, Field, Select, TextInput, type SelectOption } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { normalizeMobile, type EventSession } from "@/lib/shared";

export type QuickEntryPrefill = { name?: string; mobile?: string; globalMemberId?: string };

const GENDER_OPTIONS: SelectOption[] = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

/** On the page rather than in a pop-up: nothing clips the center list and the phone's back gesture stays simple. */
export function QuickEntryPanel({
  prefill,
  event,
  onCancel,
  onSaved,
  onEventChanged,
}: {
  prefill: QuickEntryPrefill;
  event: EventSession;
  onCancel: () => void;
  onSaved: (name: string, markedAt: string) => void;
  onEventChanged: () => void;
}) {
  const [globalMemberId, setGlobalMemberId] = useState(prefill.globalMemberId ?? "");
  const [name, setName] = useState(prefill.name ?? "");
  const [mobile, setMobile] = useState(prefill.mobile ?? "");
  const [gender, setGender] = useState("");
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
    if (!gender) return setError("Please choose a gender.");
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
          gender,
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
    <Card aria-label="Quick Entry">
      <CardHeader
        title="Quick Entry: new member"
        description={
          <>
            Will be added as a new member and marked present for <strong className="font-semibold text-ink">{event.name}</strong>.
          </>
        }
      />

      <form onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
        <Field label="Name" htmlFor="qe-name">
          <TextInput id="qe-name" icon={UserRound} required maxLength={120} autoFocus={!prefill.name} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Mobile Number" htmlFor="qe-mobile">
          <TextInput
            id="qe-mobile"
            icon={Phone}
            ref={mobileRef}
            required
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={Boolean(prefill.name)}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </Field>

        {needsConfirmation && (
          <Alert tone="warn" title="Aa mobile number aa member sathe already registered chhe.">
            <ul className="font-semibold">
              {matches.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <p className="mt-2">Continue karvu chhe ke Cancel? Family members can share a number. Continuing adds a separate member and doesn&apos;t change the existing one.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => { setMobile(""); mobileRef.current?.focus(); }}>Cancel</Button>
              <Button onClick={() => setConfirmedMobile(normalized)}>Continue</Button>
            </div>
          </Alert>
        )}

        <Field label="Gender" htmlFor="qe-gender">
          <Select id="qe-gender" value={gender} onChange={setGender} options={GENDER_OPTIONS} placeholder="Choose gender" />
        </Field>

        <Field label="Center" htmlFor="qe-center">
          <CenterSelect id="qe-center" value={center} onChange={setCenter} />
        </Field>

        <Field label="Global Member ID" hint="(optional)" htmlFor="qe-id">
          <TextInput id="qe-id" maxLength={50} autoComplete="off" value={globalMemberId} onChange={(e) => setGlobalMemberId(e.target.value)} />
        </Field>

        {error && <Alert tone="danger" title={error} />}

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" variant="success" size="lg" icon={CircleCheck} loading={busy} disabled={needsConfirmation} className="sm:flex-1">
            {busy ? "Saving…" : "Save & Mark Present"}
          </Button>
          <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onCancel}>Back to search</Button>
        </div>
      </form>
    </Card>
  );
}
