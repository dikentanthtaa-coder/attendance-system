"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CircleCheck, Phone, Search, UserRound } from "lucide-react";
import { CenterSelect, centerName, centerValue, EMPTY_CENTER, type CenterValue } from "@/components/center-select";
import { Alert, Button, Card, CardHeader, Field, Select, TextInput, type SelectOption } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";
import { normalizeMobile, normalizeName, type EventSession, type Gender } from "@/lib/shared";

export type QuickEntryPrefill = { name?: string; mobile?: string; globalMemberId?: string };

type Duplicates = {
  exact: { name: string | null } | null;
  mobileMatches: string[];
  nameMatches: { name: string; memberId: string | null; mobile: string | null; center: string }[];
};

const NOTHING_FOUND: Duplicates = { exact: null, mobileMatches: [], nameMatches: [] };

const GENDER_OPTIONS: SelectOption[] = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

/** On the page rather than in a pop-up: nothing clips the center list and the phone's back gesture stays simple. */
export function QuickEntryPanel({
  prefill,
  event,
  officerGender,
  defaultCenter,
  onCancel,
  onFindExisting,
  onSaved,
  onEventChanged,
}: {
  prefill: QuickEntryPrefill;
  event: EventSession;
  officerGender: Gender | null;
  /** The area chosen on the marking screen, ready filled in. */
  defaultCenter: string;
  onCancel: () => void;
  onFindExisting: (name: string) => void;
  onSaved: (name: string, markedAt: string) => void;
  onEventChanged: () => void;
}) {
  const [globalMemberId, setGlobalMemberId] = useState(prefill.globalMemberId ?? "");
  const [name, setName] = useState(prefill.name ?? "");
  const [mobile, setMobile] = useState(prefill.mobile ?? "");
  const [chosenGender, setChosenGender] = useState("");
  const gender = officerGender ?? chosenGender;
  const [center, setCenter] = useState<CenterValue>(defaultCenter ? centerValue(defaultCenter) : EMPTY_CENTER);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const normalized = normalizeMobile(mobile);
  const cleanName = normalizeName(name);
  const checkKey = `${cleanName.toLowerCase()}|${normalized ?? ""}`;
  const mobileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Results are stored with what they were checked for, so editing either field invalidates them.
  const [check, setCheck] = useState<{ key: string; found: Duplicates } | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);

  const found = check?.key === checkKey ? check.found : NOTHING_FOUND;
  const asksToConfirm = !found.exact && (found.mobileMatches.length > 0 || found.nameMatches.length > 0);
  const needsConfirmation = asksToConfirm && confirmedKey !== checkKey;

  useEffect(() => {
    if (!cleanName && !normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Duplicates>(`/api/officer/check-duplicate?name=${encodeURIComponent(cleanName)}&mobile=${normalized ?? ""}`, { signal: controller.signal })
        .then((result) => setCheck({ key: checkKey, found: result }))
        .catch(() => {}); // saving repeats these checks, so nothing is lost if this request fails
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cleanName, normalized, checkKey]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!normalized) return setError("Enter a valid 10-digit mobile number.");
    if (!gender) return setError("Please choose a gender.");
    if (!centerName(center)) return setError("Please choose a center. If you chose Other, type its name.");
    if (found.exact || needsConfirmation) return;

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
          confirmDuplicateMobile: confirmedKey === checkKey,
        },
      });
      onSaved(saved.memberName, saved.markedAt);
    } catch (err) {
      setBusy(false);
      // Someone added them on another device after the check above. Show the same warning.
      if (err instanceof ClientApiError && err.code === "duplicate_mobile") {
        setCheck({ key: checkKey, found: { ...NOTHING_FOUND, mobileMatches: err.data.matches as string[] } });
        return;
      }
      if (err instanceof ClientApiError && err.code === "duplicate_name") {
        setCheck({ key: checkKey, found: { ...NOTHING_FOUND, nameMatches: err.data.nameMatches as Duplicates["nameMatches"] } });
        return;
      }
      if (err instanceof ClientApiError && err.code === "member_exists") {
        setCheck({ key: checkKey, found: { ...NOTHING_FOUND, exact: { name: cleanName } } });
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
            Will be saved{officerGender && <> as <strong className="font-semibold text-ink">{officerGender}</strong></>} and marked present for <strong className="font-semibold text-ink">{event.name}</strong>.
          </>
        }
      />

      <form onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
        <Field label="Name" htmlFor="qe-name">
          <TextInput id="qe-name" ref={nameRef} icon={UserRound} required maxLength={120} autoFocus={!prefill.name} value={name} onChange={(e) => setName(e.target.value)} />
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

        {found.exact && (
          <Alert tone="danger" title="This member already exists. They can't be added again.">
            <p>{found.exact.name ?? cleanName} is already registered with this mobile number.</p>
            {found.exact.name && (
              <div className="mt-3">
                <Button icon={Search} onClick={() => onFindExisting(found.exact!.name!)}>Find this member</Button>
              </div>
            )}
          </Alert>
        )}

        {needsConfirmation && (
          <Alert tone="warn" title={found.mobileMatches.length > 0 ? "Aa mobile number aa member sathe already registered chhe." : "Aa naam no member already registered chhe."}>
            <ul className="font-semibold">
              {found.mobileMatches.map((m, i) => <li key={`m-${i}`}>{m}</li>)}
              {found.nameMatches.map((m, i) => (
                <li key={`n-${i}`}>
                  {m.name}
                  <span className="font-normal text-muted"> {[m.memberId, m.mobile, m.center].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Continue karvu chhe ke Cancel? {found.mobileMatches.length > 0 ? "Family members can share a number." : "Two people can share a name."} Continuing adds a separate member and doesn&apos;t change the existing one.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  if (found.mobileMatches.length > 0) {
                    setMobile("");
                    mobileRef.current?.focus();
                  } else {
                    setName("");
                    nameRef.current?.focus();
                  }
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => setConfirmedKey(checkKey)}>Continue</Button>
            </div>
          </Alert>
        )}

        {/* An officer's account decides this. Only Admin, who covers everyone, has to choose. */}
        {!officerGender && (
          <Field label="Gender" htmlFor="qe-gender">
            <Select id="qe-gender" value={chosenGender} onChange={setChosenGender} options={GENDER_OPTIONS} placeholder="Choose gender" />
          </Field>
        )}

        <Field label="Center" htmlFor="qe-center">
          <CenterSelect id="qe-center" value={center} onChange={setCenter} />
        </Field>

        <Field label="Global Member ID" hint="(optional)" htmlFor="qe-id">
          <TextInput id="qe-id" maxLength={50} autoComplete="off" value={globalMemberId} onChange={(e) => setGlobalMemberId(e.target.value)} />
        </Field>

        {error && <Alert tone="danger" title={error} />}

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" variant="success" size="lg" icon={CircleCheck} loading={busy} disabled={needsConfirmation || Boolean(found.exact)} className="sm:flex-1">
            {busy ? "Saving…" : "Save & Mark Present"}
          </Button>
          <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={onCancel}>Back to search</Button>
        </div>
      </form>
    </Card>
  );
}
