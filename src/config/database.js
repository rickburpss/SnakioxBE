import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (env.storageDriver !== "postgres") {
    throw new Error("PostgreSQL is not enabled");
  }

  if (!pool) {
    // Supabase (and any managed Postgres) requires TLS. Enable SSL for any
    // non-local host regardless of NODE_ENV, otherwise the pooler refuses the
    // connection and the process throws on first query.
    const useSsl = !isLocalDatabase(env.databaseUrl);

    pool = new Pool({
      connectionString: env.databaseUrl,
      max: env.databasePoolMax,
      idleTimeoutMillis: env.databaseIdleTimeoutMs,
      connectionTimeoutMillis: env.databaseConnectionTimeoutMs,
      allowExitOnIdle: false,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });

    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error", error);
    });
  }

  return pool;
}

export async function closeDatabase() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

function isLocalDatabase(url) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}
