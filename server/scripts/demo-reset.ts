import "./load-demo-env";
import { workerLogger } from "../src/observability/logger";
import {
  assertDemoMode,
  deleteDemoFixtures,
  insertDemoFixtures,
  withDirectClient,
} from "./demo-utils";

async function main() {
  assertDemoMode();

  const result = await withDirectClient("notichilec-demo-reset", async (client) => {
    await client.query("BEGIN");
    try {
      await deleteDemoFixtures(client);
      const inserted = await insertDemoFixtures(client);
      await client.query("COMMIT");
      return { inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  workerLogger.info("demo_reset_completed", {
    job: "demo_reset",
    inserted: result.inserted,
  });
}

main().catch((error) => {
  workerLogger.error("demo_reset_failed", {
    job: "demo_reset",
    error_code: "demo_reset_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  process.exit(1);
});
