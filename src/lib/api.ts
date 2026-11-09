import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function toResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ code: err.code, message: err.message, ...err.data }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "Invalid input.";
    return NextResponse.json({ code: "invalid_input", message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ code: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
}

type Handler<U, C> = (user: U, req: Request, ctx: C) => Promise<Response | object>;

function guarded<U, C>(authorize: (user: SessionUser | null) => U, handler: Handler<U, C>) {
  return async (req: Request, ctx: C) => {
    try {
      const result = await handler(authorize(await getCurrentUser()), req, ctx);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      return toResponse(err);
    }
  };
}

function loggedIn(user: SessionUser | null): SessionUser {
  if (!user) throw new ApiError(401, "unauthenticated", "Please log in again.");
  return user;
}

/** Someone logged in with a temporary password can do nothing else until they replace it. */
function signedIn(user: SessionUser | null): SessionUser {
  const u = loggedIn(user);
  if (u.mustChangePassword) throw new ApiError(403, "password_change_required", "Please set a new password first.");
  return u;
}

export const changePasswordRoute = <C = unknown>(handler: Handler<SessionUser, C>) => guarded(loggedIn, handler);

export const anyUserRoute = <C = unknown>(handler: Handler<SessionUser, C>) => guarded(signedIn, handler);

export const adminRoute = <C = unknown>(handler: Handler<SessionUser, C>) =>
  guarded((user) => {
    if (signedIn(user).role !== "admin") throw new ApiError(403, "forbidden", "Only Admin can do this.");
    return user as SessionUser;
  }, handler);

/** Wrap unauthenticated routes (login, registration) for the same error handling. */
export function publicRoute(handler: (req: Request) => Promise<Response | object>) {
  return async (req: Request) => {
    try {
      const result = await handler(req);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      return toResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "invalid_input", "Invalid request.");
  }
}
