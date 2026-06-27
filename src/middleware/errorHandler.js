import { ZodError } from "zod";
import { ApiError } from "../utils/errors.js";

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isTransientDatabaseOverload(error)) {
    console.error("Transient database overload", error);
    res.set("Retry-After", "2");
    res.status(503).json({ error: "Database is busy, please retry" });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: error.flatten(),
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.message,
      details: error.details,
    });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
}

// Postgres SQLSTATE codes that mean "the DB is momentarily unavailable / at
// capacity" rather than a real application error — safe to surface as 503.
const TRANSIENT_DB_CODES = new Set([
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
]);

function isTransientDatabaseOverload(error) {
  const code = error?.code || error?.cause?.code;
  if (code && TRANSIENT_DB_CODES.has(String(code))) {
    return true;
  }

  // pg's pool connect timeout is a plain Error with no SQLSTATE, so fall back to
  // matching its (stable) message wording.
  const messages = [error?.message, error?.cause?.message]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return messages.some(
    (message) =>
      message.includes("timeout exceeded when trying to connect") ||
      message.includes("connection terminated due to connection timeout"),
  );
}
