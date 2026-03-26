/**
 * Script de prueba para enviar una notificación push a todos los dispositivos registrados.
 * Útil para verificar que el flujo de push funciona sin esperar al worker.
 *
 * Uso: npm run test-push
 */
import "dotenv/config";
import { sendPushToAll, getActiveTokens } from "../src/push";
import { closePool } from "../src/db";

async function main() {
  console.log("=== Test de Push Notification ===\n");

  const tokens = await getActiveTokens();
  console.log(`Tokens activos encontrados: ${tokens.length}`);

  if (tokens.length === 0) {
    console.log("\n⚠️  No hay dispositivos registrados.");
    console.log("   Abre la app en un dispositivo físico primero.\n");
    await closePool();
    return;
  }

  console.log("Tokens:", tokens.map((t) => t.slice(0, 35) + "...").join("\n       "));
  console.log("\nEnviando notificación de prueba...\n");

  const result = await sendPushToAll(
    "🔔 Test NotiChileC",
    "Esta es una notificación de prueba. Si la ves, ¡el sistema funciona!",
    {
      type: "test",
      timestamp: new Date().toISOString(),
    }
  );

  console.log(`\n✅ Resultado:`);
  console.log(`   Enviadas: ${result.sent}`);
  console.log(`   Fallidas: ${result.failed}`);
  console.log(`   Tokens desactivados: ${result.invalidTokens.length}`);

  await closePool();
}

main().catch(async (error) => {
  console.error("Error:", error);
  await closePool();
  process.exit(1);
});
