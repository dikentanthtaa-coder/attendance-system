export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Fetch wrapper: JSON in and out, typed errors, and a redirect when the session has expired. */
export async function api<T>(url: string, options: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? (options.json !== undefined || options.body ? "POST" : "GET"),
      headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ClientApiError(0, "network", "No connection. Check the internet and try again.", {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A full page load on purpose: it discards all in-memory state from the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && data.code === "unauthenticated") window.location.assign("/login");
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 403 && data.code === "password_change_required") window.location.assign("/change-password");
    throw new ClientApiError(res.status, data.code ?? "error", data.message ?? "Something went wrong.", data);
  }
  return data as T;
}
