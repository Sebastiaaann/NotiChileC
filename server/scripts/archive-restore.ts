import "dotenv/config";
import { restoreArchivePartition, type ArchiveEntity } from "../src/archive-jobs";
import { workerLogger } from "../src/observability/logger";
import { flushSentry, initSentry } from "../src/observability/sentry";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  initSentry("notichilec-archive-restore");

  const entity = readArg("entity") as ArchiveEntity | undefined;
  const partitionMonth = readArg("partition");
  const tempTableName = readArg("table");

  if (!entity || !partitionMonth) {
    throw new Error("Uso: npm run archive:restore -- --entity=licitaciones --partition=2025-03 [--table=audit_restore]");
  }

  const result = await restoreArchivePartition({
    entity,
    partitionMonth,
    tempTableName,
  });

  workerLogger.info("archive_restore_completed", {
    job: "archive_restore",
    entity,
    partition_month: partitionMonth,
    table_name: result.tableName,
    restored_rows: result.rowCount,
  });

  await flushSentry();
}

void main().catch(async (error) => {
  workerLogger.error("archive_restore_failed", {
    job: "archive_restore",
    error_code: "archive_restore_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  await flushSentry();
  process.exit(1);
});
