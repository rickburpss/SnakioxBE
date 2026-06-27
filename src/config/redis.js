import { createClient } from "redis";
import { env } from "./env.js";

// Single shared Redis connection, created lazily. If REDIS_URL is unset, or the
// connection fails, callers get `null` and the app degrades gracefully to its
// per-instance in-memory paths (idempotency + rate limiting) instead of erroring.

let client = null;
let connecting = null;

export function isRedisConfigured() {
  return Boolean(env.redisUrl);
}

export async function getRedis() {
  if (!env.redisUrl) return null;
  if (client?.isReady) return client;

  if (!connecting) {
    client = createClient({ url: env.redisUrl });
    client.on("error", (error) => console.error("Redis error", error));
    connecting = client
      .connect()
      .then(() => client)
      .catch((error) => {
        console.error("Redis connect failed; continuing without it", error);
        client = null;
        connecting = null;
        return null;
      });
  }

  return connecting;
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // ignore — shutting down anyway
  }
  client = null;
  connecting = null;
}
