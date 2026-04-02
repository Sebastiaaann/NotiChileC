/**
 * Script de prueba para enviar una notificación push a todos los dispositivos registrados.
 * Útil para verificar que el flujo de push funciona sin esperar al worker.
 *
 * Uso: npm run test-push
 */
import "dotenv/config";
import { createExpoPushProvider } from "../src/push";
import { closePool, query } from "../src/db";
import type { PushNotificationInput } from "../src/push-provider";

async function main() {
  console.log("=== Test de Push Notification ===\n");

  const installations = await query<{
    installation_id: string;
    push_token: string;
  }>(
    `SELECT installation_id, push_token
     FROM device_installations
     WHERE active = TRUE
       AND push_capable = TRUE
       AND push_token IS NOT NULL`
  );

  console.log(`Instalaciones activas encontradas: ${installations.length}`);

  if (installations.length === 0) {
    console.log("\n⚠️  No hay instalaciones push activas.\n");
    await closePool();
    return;
  }

  console.log(
    "Tokens:",
    installations
      .map((installation) => installation.push_token.slice(0, 35) + "...")
      .join("\n       ")
  );
  console.log("\nEnviando notificación de prueba...\n");

  const provider = createExpoPushProvider();
  const inputs: PushNotificationInput[] = installations.map((installation) => ({
    installationId: installation.installation_id,
    pushToken: installation.push_token,
    title: "🔔 Test NotiChileC",
    body: "Esta es una notificación de prueba. Si la ves, ¡el sistema funciona!",
    data: {
      type: "test",
      timestamp: new Date().toISOString(),
    },
  }));

  const result = await provider.send(inputs);

  console.log(`\n✅ Resultado:`);
  console.log(`   Enviadas: ${result.filter((r) => r.status === "sent").length}`);
  console.log(`   Fallidas: ${result.filter((r) => r.status !== "sent").length}`);
  console.log(
    `   Tokens desactivados: ${
      result.filter((r) => r.status === "invalid").length
    }`
  );

  await closePool();
}

main().catch(async (error) => {
  console.error("Error:", error);
  await closePool();
  process.exit(1);
});
