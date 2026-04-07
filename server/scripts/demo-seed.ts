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

  const inserted = await withDirectClient("notichilec-demo-seed", async (client) => {
    await client.query("BEGIN");
    try {
      await deleteDemoFixtures(client);
      const count = await insertDemoFixtures(client);
      await client.query("COMMIT");
      return count;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  workerLogger.info("demo_seed_completed", {
    job: "demo_seed",
    inserted,
  });
}

main().catch((error) => {
  workerLogger.error("demo_seed_failed", {
    job: "demo_seed",
    error_code: "demo_seed_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  process.exit(1);
});
