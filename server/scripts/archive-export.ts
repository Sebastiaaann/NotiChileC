import "dotenv/config";
import { createDirectPool } from "../src/db";
import { workerLogger } from "../src/observability/logger";
import { flushSentry, initSentry } from "../src/observability/sentry";
import { runArchiveExportCycle } from "../src/archive-jobs";

async function main() {
  initSentry("notichilec-archive-export");
  const pool = createDirectPool("notichilec-archive-export");

  try {
    const summary = await runArchiveExportCycle({
      query: async (text, params = []) => {
        const result = await pool.query(text, params);
        return result.rows as Record<string, unknown>[];
      },
      queryResult: async (text, params = []) => {
        return pool.query(text, params);
      },
    });

    workerLogger.info("archive_export_script_completed", {
      job: "archive_export",
      exported: summary.exported,
      verified: summary.verified,
      dropped: summary.dropped,
      failed: summary.failed,
    });
  } finally {
    await pool.end();
    await flushSentry();
  }
}

void main().catch(async (error) => {
  workerLogger.error("archive_export_script_failed", {
    job: "archive_export",
    error_code: "archive_export_script_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  await flushSentry();
  process.exit(1);
});
