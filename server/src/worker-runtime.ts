import cron, { type ScheduledTask } from "node-cron";
import { workerLogger } from "./observability/logger";
import { captureException } from "./observability/sentry";
import {
  runArchiveExportCycle,
  runCleanupCycle,
  runDispatchCycle,
  runIngestCycle,
  runReceiptCycle,
} from "./worker";

const INGEST_INTERVAL = Number(process.env.WORKER_INTERVAL_MINUTES) || 2;
const DISPATCH_INTERVAL = Number(process.env.DISPATCH_INTERVAL_MINUTES) || 1;
const RECEIPT_INTERVAL = Number(process.env.RECEIPT_INTERVAL_MINUTES) || 1;
const CLEANUP_CRON = process.env.CLEANUP_CRON ?? "17 3 * * *";
const ARCHIVE_EXPORT_CRON = process.env.ARCHIVE_EXPORT_CRON ?? "47 3 * * *";

let ingestRunning = false;
let dispatchRunning = false;
let receiptRunning = false;
let cleanupRunning = false;
let archiveExportRunning = false;

async function runWithLock(
  flag: "ingest" | "dispatch" | "receipt" | "cleanup" | "archive_export"
) {
  const current =
    flag === "ingest"
      ? ingestRunning
      : flag === "dispatch"
        ? dispatchRunning
        : flag === "receipt"
          ? receiptRunning
          : flag === "cleanup"
            ? cleanupRunning
            : archiveExportRunning;

  if (current) {
    workerLogger.warn("worker_already_running", { job: flag });
    return false;
  }

  if (flag === "ingest") ingestRunning = true;
  if (flag === "dispatch") dispatchRunning = true;
  if (flag === "receipt") receiptRunning = true;
  if (flag === "cleanup") cleanupRunning = true;
  if (flag === "archive_export") archiveExportRunning = true;

  return true;
}

function releaseLock(
  flag: "ingest" | "dispatch" | "receipt" | "cleanup" | "archive_export"
) {
  if (flag === "ingest") ingestRunning = false;
  if (flag === "dispatch") dispatchRunning = false;
  if (flag === "receipt") receiptRunning = false;
  if (flag === "cleanup") cleanupRunning = false;
  if (flag === "archive_export") archiveExportRunning = false;
}

async function executeLockedWorker(
  job: "ingest" | "dispatch" | "receipt" | "cleanup" | "archive_export",
  runner: () => Promise<unknown>
): Promise<void> {
  if (!(await runWithLock(job))) return;

  try {
    await runner();
  } catch (error) {
    captureException(error, { job });
    workerLogger.error("worker_runtime_error", {
      job,
      error_code: "worker_runtime_error",
      error: error instanceof Error ? error : new Error(String(error)),
    });
  } finally {
    releaseLock(job);
  }
}

export async function executeIngestWorker(): Promise<void> {
  await executeLockedWorker("ingest", runIngestCycle);
}

export async function executeDispatchWorker(): Promise<void> {
  await executeLockedWorker("dispatch", runDispatchCycle);
}

export async function executeReceiptWorker(): Promise<void> {
  await executeLockedWorker("receipt", runReceiptCycle);
}

export async function executeCleanupWorker(): Promise<void> {
  await executeLockedWorker("cleanup", runCleanupCycle);
}

export async function executeArchiveExportWorker(): Promise<void> {
  await executeLockedWorker("archive_export", runArchiveExportCycle);
}

export async function executeWorker(): Promise<void> {
  await executeIngestWorker();
  await executeDispatchWorker();
  await executeReceiptWorker();
  await executeCleanupWorker();
  await executeArchiveExportWorker();
}

export function startWorkerScheduler(options?: {
  intervalMinutes?: number;
  runImmediately?: boolean;
}): { stop: () => void } {
  const ingestInterval = options?.intervalMinutes ?? INGEST_INTERVAL;
  const runImmediately = options?.runImmediately ?? true;
  const dispatchInterval = DISPATCH_INTERVAL;
  const receiptInterval = RECEIPT_INTERVAL;

  const tasks: ScheduledTask[] = [
    cron.schedule(`*/${ingestInterval} * * * *`, () => {
      void executeIngestWorker();
    }),
    cron.schedule(`*/${dispatchInterval} * * * *`, () => {
      void executeDispatchWorker();
    }),
    cron.schedule(`*/${receiptInterval} * * * *`, () => {
      void executeReceiptWorker();
    }),
    cron.schedule(CLEANUP_CRON, () => {
      void executeCleanupWorker();
    }),
    cron.schedule(ARCHIVE_EXPORT_CRON, () => {
      void executeArchiveExportWorker();
    }),
  ];

  workerLogger.info("worker_scheduler_started", {
    job: "scheduler",
    ingest_interval_minutes: ingestInterval,
    dispatch_interval_minutes: dispatchInterval,
    receipt_interval_minutes: receiptInterval,
    cleanup_cron: CLEANUP_CRON,
    archive_export_cron: ARCHIVE_EXPORT_CRON,
  });

  if (runImmediately) {
    setTimeout(() => {
      workerLogger.info("worker_scheduler_initial_run");
      void executeWorker();
    }, 3_000);
  }

  return {
    stop: () => {
      tasks.forEach((task) => task.stop());
    },
  };
}
