import "server-only";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

const store = globalThis as unknown as { __sql?: Sql };

/**
 * One small pool per server instance. `prepare: false` is required by the Supabase
 * transaction pooler. Created lazily so that `next build` works without a database.
 */
export function getSql(): Sql {
  if (store.__sql) return store.__sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1/.test(url);
  store.__sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
  });
  return store.__sql;
}

/** Runs `fn` in a transaction. Query fragments use the same tagged-template syntax as getSql(). */
export async function withTransaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  // postgres.js's TransactionSql type omits the call signature, though it is callable.
  return getSql().begin((tx) => fn(tx as unknown as Sql)) as Promise<T>;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && (!constraint || e.constraint_name === constraint);
}
