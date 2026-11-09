"use client";

import { useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { Alert, Button, Field, PasswordInput, TextInput } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client-api";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { redirectTo } = await api<{ redirectTo: string }>("/api/auth/login", { json: { username, password } });
      window.location.assign(redirectTo);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Email, Mobile or Username" htmlFor="username">
        <TextInput
          id="username"
          icon={UserRound}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Alert tone="danger" title={error} />}
      <Button type="submit" size="lg" loading={busy} className="w-full">{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}
