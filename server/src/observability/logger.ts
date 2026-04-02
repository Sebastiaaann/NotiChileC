import { inspect } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";
const configuredFormat = (process.env.LOG_FORMAT || "json").toLowerCase();
const runtimeEnv = process.env.NODE_ENV || "development";

export interface LogContext {
  request_id?: string;
  run_id?: number | string;
  job?: string;
  duration_ms?: number;
  error_code?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[configuredLevel];
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested),
      ])
    );
  }

  return value;
}

function write(level: LogLevel, message: string, entry: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    env: runtimeEnv,
    message,
    ...entry,
  };

  if (configuredFormat === "pretty") {
    const rendered = inspect(payload, { depth: 6, colors: false, breakLength: 120 });
    const writer = level === "error" ? process.stderr : process.stdout;
    writer.write(`${rendered}\n`);
    return;
  }

  const writer = level === "error" ? process.stderr : process.stdout;
  writer.write(`${JSON.stringify(normalizeValue(payload))}\n`);
}

export interface Logger {
  child(context: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export function createLogger(service: string, baseContext: LogContext = {}): Logger {
  const context = { service, ...baseContext };

  const log = (level: LogLevel, message: string, extra: LogContext = {}) => {
    write(level, message, { ...context, ...extra });
  };

  return {
    child(childContext: LogContext) {
      return createLogger(service, { ...context, ...childContext });
    },
    debug(message: string, extra?: LogContext) {
      log("debug", message, extra);
    },
    info(message: string, extra?: LogContext) {
      log("info", message, extra);
    },
    warn(message: string, extra?: LogContext) {
      log("warn", message, extra);
    },
    error(message: string, extra?: LogContext) {
      log("error", message, extra);
    },
  };
}

export const apiLogger = createLogger("api");
export const workerLogger = createLogger("worker");
export const combinedLogger = createLogger("combined");
