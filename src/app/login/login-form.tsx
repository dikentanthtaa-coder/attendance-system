"use client";

import { useState, type FormEvent } from "react";
import { api, Button, ClientApiError, ErrorNote, Field, inputClass } from "@/components/ui";

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
      <Field label="Username" htmlFor="username">
        <input
          id="username"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          required
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}
