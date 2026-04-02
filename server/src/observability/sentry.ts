import * as Sentry from "@sentry/node";

interface CaptureContext {
  requestId?: string;
  job?: string;
  runId?: string | number;
  route?: string;
  method?: string;
  statusCode?: number;
}

let initialized = false;

export function initSentry(serviceName: string): void {
  if (initialized) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    serverName: serviceName,
    tracesSampleRate: 0,
  });

  initialized = true;
}

export function captureException(error: unknown, context: CaptureContext = {}): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag("request_id", context.requestId);
    if (context.job) scope.setTag("job", context.job);
    if (context.runId !== undefined) scope.setTag("run_id", String(context.runId));
    if (context.route) scope.setTag("route", context.route);
    if (context.method) scope.setTag("method", context.method);
    if (context.statusCode !== undefined) scope.setTag("status_code", String(context.statusCode));
    Sentry.captureException(error);
  });
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}
