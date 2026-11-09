"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Clock, Mail, Phone } from "lucide-react";
import { Alert, Button, EmptyState, Field, LinkButton, PasswordInput, TextInput } from "@/components/ui";
import { api } from "@/lib/client-api";
import { MIN_PASSWORD_LENGTH } from "@/lib/shared";

const EMPTY = { firstName: "", lastName: "", mobile: "", email: "", password: "", confirmPassword: "" };

export function RegisterForm() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const mismatch = form.confirmPassword !== "" && form.password !== form.confirmPassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) return setError("Password and Confirm Password don't match.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/register", { json: form });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <EmptyState
        icon={Clock}
        titleAs="h2"
        title="Registration received"
        description="Admin needs to approve your account. After that, log in with your email or mobile number."
        action={<LinkButton href="/login" variant="primary">Back to log in</LinkButton>}
      />
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold">Register as Attendance Officer</h2>
      <p className="mt-0.5 mb-5 text-muted">Admin approves your account before you can log in.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First Name" htmlFor="first-name">
            <TextInput id="first-name" required autoFocus maxLength={60} autoComplete="given-name" value={form.firstName} onChange={set("firstName")} />
          </Field>
          <Field label="Last Name" htmlFor="last-name">
            <TextInput id="last-name" required maxLength={60} autoComplete="family-name" value={form.lastName} onChange={set("lastName")} />
          </Field>
        </div>
        <Field label="Mobile Number" htmlFor="reg-mobile">
          <TextInput id="reg-mobile" icon={Phone} required type="tel" inputMode="numeric" autoComplete="tel" value={form.mobile} onChange={set("mobile")} />
        </Field>
        <Field label="Email" hint="(Gmail or any other)" htmlFor="reg-email">
          <TextInput id="reg-email" icon={Mail} required type="email" maxLength={200} autoCapitalize="none" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Set Password" hint={`(at least ${MIN_PASSWORD_LENGTH} characters)`} htmlFor="reg-password">
          <PasswordInput id="reg-password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Confirm Password" htmlFor="reg-confirm">
          <PasswordInput id="reg-confirm" required autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} />
        </Field>
        {mismatch && <p className="-mt-2 text-sm font-medium text-danger">The two passwords don&apos;t match yet.</p>}
        {error && <Alert tone="danger" title={error} />}
        <Button type="submit" size="lg" loading={busy} className="w-full">{busy ? "Registering…" : "Register"}</Button>
      </form>

      <p className="mt-3 text-center text-sm text-muted">
        Already registered? <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand underline">Log in</Link>
      </p>
    </>
  );
}
