export function concurrencyLimit({
  maxConcurrent,
  maxQueue = Number.POSITIVE_INFINITY,
  acquireTimeoutMs = 0,
  retryAfterSeconds = 1,
  message = "Server is busy, please retry"
}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be a positive integer");
  }

  function reject(res) {
    if (res.headersSent) return;
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(503).json({ error: message });
  }

  let active = 0;
  const queue = [];

  function removeFromQueue(entry) {
    const index = queue.indexOf(entry);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  function drainQueue() {
    while (active < maxConcurrent && queue.length > 0) {
      const nextEntry = queue.shift();
      nextEntry?.grant();
    }
  }

  return function concurrencyLimitMiddleware(req, res, next) {
    let entered = false;
    let released = false;
    let timeout = null;

    const entry = {
      waiting: true,
      grant() {
        if (!entry.waiting || entered) return;
        clearTimeout(timeout);
        req.off("close", abortWhileQueued);
        entry.waiting = false;
        entered = true;
        active += 1;
        res.on("finish", release);
        res.on("close", release);
        next();
      }
    };

    function release() {
      if (!entered || released) return;
      released = true;
      active = Math.max(active - 1, 0);
      drainQueue();
    }

    function abortWhileQueued() {
      if (!entry.waiting) return;
      clearTimeout(timeout);
      entry.waiting = false;
      removeFromQueue(entry);
    }

    if (active < maxConcurrent) {
      entry.grant();
      return;
    }

    if (queue.length >= maxQueue) {
      reject(res);
      return;
    }

    queue.push(entry);
    req.on("close", abortWhileQueued);

    if (acquireTimeoutMs > 0) {
      timeout = setTimeout(() => {
        if (!entry.waiting) return;
        entry.waiting = false;
        removeFromQueue(entry);
        req.off("close", abortWhileQueued);
        reject(res);
      }, acquireTimeoutMs);
      timeout.unref?.();
    }
  };
}
