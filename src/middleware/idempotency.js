import { getRedis } from "../config/redis.js";

// Idempotency layer.
//
// When a request carries an `Idempotency-Key` header, the first request for that
// key runs normally and its response is cached. Concurrent requests with the
// same key wait for and replay the first response, and retries within the TTL
// replay the cached response — instead of re-running the handler and returning a
// 409 Conflict. This protects the wallet/mint flows from double-submits/races.
//
// With Redis configured, the cache + in-flight lock are shared across every
// backend instance. Without it, each instance falls back to its own memory
// (correct for a single instance).

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000; // max time one request may "own" a key
const WAIT_POLL_MS = 100;
const WAIT_MAX_TRIES = 50; // ~5s ceiling waiting on a concurrent in-flight request

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- in-memory fallback state (per instance) ----
const completed = new Map(); // key -> { status, body, expiresAt }
const inFlight = new Map(); // key -> Promise<{ status, body }>

function purgeExpired(now) {
  for (const [key, entry] of completed) {
    if (entry.expiresAt <= now) completed.delete(key);
  }
}

export function idempotency({ ttlMs = DEFAULT_TTL_MS } = {}) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get("Idempotency-Key");
    if (!key) return next();

    const redis = await getRedis();
    if (redis) return handleWithRedis({ redis, key, ttlMs, res, next });
    return handleInMemory({ key, ttlMs, res, next });
  };
}

async function handleWithRedis({ redis, key, ttlMs, res, next }) {
  const doneKey = `idemp:done:${key}`;
  const lockKey = `idemp:lock:${key}`;

  try {
    const cached = await redis.get(doneKey);
    if (cached) return replay(res, JSON.parse(cached));

    // Claim the right to process this key. NX => only the first request wins.
    const gotLock = await redis.set(lockKey, "1", { NX: true, PX: LOCK_TTL_MS });
    if (!gotLock) {
      // Another request (possibly on another instance) is processing it — wait
      // briefly for its result, then give up and proceed best-effort.
      for (let i = 0; i < WAIT_MAX_TRIES; i++) {
        await sleep(WAIT_POLL_MS);
        const raw = await redis.get(doneKey);
        if (raw) return replay(res, JSON.parse(raw));
      }
      return next();
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      if (status < 500) {
        redis.set(doneKey, JSON.stringify({ status, body }), { PX: ttlMs }).catch(() => {});
      }
      redis.del(lockKey).catch(() => {});
      return originalJson(body);
    };

    res.on("close", () => {
      redis.del(lockKey).catch(() => {});
    });

    return next();
  } catch (error) {
    // Redis hiccup must never break the request — fall through to the handler.
    console.error("Idempotency (redis) error; proceeding", error);
    return next();
  }
}

function handleInMemory({ key, ttlMs, res, next }) {
  purgeExpired(Date.now());

  const cached = completed.get(key);
  if (cached) return replay(res, cached);

  const pending = inFlight.get(key);
  if (pending) {
    return pending.then(
      (result) => replay(res, result),
      () => next() // original failed before responding; let this one proceed
    );
  }

  let settle;
  let fail;
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  promise.catch(() => {}); // avoid unhandled rejection when no one is waiting
  inFlight.set(key, promise);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    if (status < 500) {
      completed.set(key, { status, body, expiresAt: Date.now() + ttlMs });
    }
    inFlight.delete(key);
    settle({ status, body });
    return originalJson(body);
  };

  res.on("close", () => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
      fail(new Error("idempotency: request closed before response"));
    }
  });

  return next();
}

function replay(res, { status, body }) {
  res.setHeader("Idempotent-Replay", "true");
  return res.status(status).json(body);
}
