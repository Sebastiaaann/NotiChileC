import "./load-demo-env";
import { createExpoPushProvider } from "../src/push";
import { closePool, query } from "../src/db";
import { workerLogger } from "../src/observability/logger";
import type { PushNotificationInput } from "../src/push-provider";

interface InstallationRow extends Record<string, unknown> {
  installation_id: string;
  push_token: string | null;
}

async function main() {
  const provider = createExpoPushProvider();
  const targetInstallationId = process.env.DEMO_PUSH_INSTALLATION_ID?.trim();

  const rows = await query<InstallationRow>(
    `SELECT installation_id, push_token
     FROM device_installations
     WHERE active = TRUE
       AND push_capable = TRUE
       AND push_token IS NOT NULL
       AND ($1::text IS NULL OR installation_id = $1)`,
    [targetInstallationId || null]
  );

  if (rows.length === 0) {
    workerLogger.warn("push_smoke_skipped", {
      job: "push_smoke",
      reason: "no_active_installations",
      target_installation_id: targetInstallationId ?? null,
    });
    await closePool();
    return;
  }

  const inputs: PushNotificationInput[] = rows.map((row) => ({
    installationId: row.installation_id,
    pushToken: row.push_token as string,
    title: "🔔 Demo NotiChileC",
    body: "Esta es una notificación de smoke para la demo controlada.",
    data: {
      type: "demo_smoke",
      timestamp: new Date().toISOString(),
    },
  }));

  const outcomes = await provider.send(inputs);

  workerLogger.info("push_smoke_completed", {
    job: "push_smoke",
    targeted: inputs.length,
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    failed: outcomes.filter((outcome) => outcome.status !== "sent").length,
  });

  await closePool();
}

main().catch(async (error) => {
  workerLogger.error("push_smoke_failed", {
    job: "push_smoke",
    error_code: "push_smoke_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  await closePool();
  process.exit(1);
});
