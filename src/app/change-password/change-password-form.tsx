"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, PasswordInput } from "@/components/ui";
import { api } from "@/lib/client-api";
import { MIN_PASSWORD_LENGTH } from "@/lib/shared";

export function ChangePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPassword !== "" && password !== confirmPassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) return setError("New Password and Confirm Password don't match.");
    setBusy(true);
    setError("");
    try {
      const { redirectTo } = await api<{ redirectTo: string }>("/api/auth/change-password", { json: { password, confirmPassword } });
      window.location.assign(redirectTo);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-bold">Set a new password</h2>
      <p className="mt-0.5 mb-5 text-muted">Admin reset your password. Choose your own to continue.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="New Password" hint={`(at least ${MIN_PASSWORD_LENGTH} characters)`} htmlFor="new-password">
          <PasswordInput id="new-password" placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} required autoFocus minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm Password" htmlFor="confirm-password">
          <PasswordInput id="confirm-password" placeholder="Type the same password again" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>
        {mismatch && <p className="-mt-2 text-sm font-medium text-danger">The two passwords don&apos;t match yet.</p>}
        {error && <Alert tone="danger" title={error} />}
        <Button type="submit" size="lg" loading={busy} className="w-full">{busy ? "Saving…" : "Save New Password"}</Button>
      </form>
      <Button
        variant="ghost"
        className="mt-3 w-full"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.replace("/login");
          router.refresh();
        }}
      >
        Log out
      </Button>
    </>
  );
}
