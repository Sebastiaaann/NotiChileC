import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { query } from "./db";

const expo = new Expo();

interface DeviceTokenRow {
  expo_push_token: string;
  [key: string]: unknown;
}

/**
 * Obtiene todos los tokens de dispositivos activos desde la DB.
 */
export async function getActiveTokens(): Promise<string[]> {
  const rows = await query<DeviceTokenRow>(
    "SELECT expo_push_token FROM device_tokens WHERE active = TRUE"
  );
  return rows.map((r) => r.expo_push_token);
}

/**
 * Envía notificación push a todos los dispositivos registrados.
 * Retorna la cantidad de notificaciones enviadas exitosamente.
 */
export async function sendPushToAll(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const tokens = await getActiveTokens();

  if (tokens.length === 0) {
    console.log("[push] No hay dispositivos registrados");
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  // Construir mensajes (solo tokens válidos de Expo)
  const messages: ExpoPushMessage[] = [];
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    if (!Expo.isExpoPushToken(token)) {
      console.warn(`[push] Token inválido, será desactivado: ${token}`);
      invalidTokens.push(token);
      continue;
    }

    messages.push({
      to: token,
      sound: "default",
      title,
      body,
      data: data ?? {},
      priority: "high",
    });
  }

  if (messages.length === 0) {
    await deactivateTokens(invalidTokens);
    return { sent: 0, failed: 0, invalidTokens };
  }

  // Enviar en chunks (Expo limita a 100 por request)
  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] =
        await expo.sendPushNotificationsAsync(chunk);

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === "ok") {
          sent++;
        } else {
          failed++;
          // Si el token ya no es válido, marcarlo para desactivar
          if (
            ticket.details?.error === "DeviceNotRegistered"
          ) {
            const msg = chunk[i];
            const tokenStr = typeof msg.to === "string" ? msg.to : msg.to[0];
            invalidTokens.push(tokenStr);
          }
        }
      }
    } catch (error) {
      console.error("[push] Error enviando chunk:", error);
      failed += chunk.length;
    }
  }

  // Desactivar tokens inválidos
  if (invalidTokens.length > 0) {
    await deactivateTokens(invalidTokens);
  }

  console.log(
    `[push] Enviadas: ${sent}, Fallidas: ${failed}, Tokens desactivados: ${invalidTokens.length}`
  );

  return { sent, failed, invalidTokens };
}

/**
 * Desactiva tokens que ya no son válidos en la DB.
 */
async function deactivateTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  try {
    await query(
      "UPDATE device_tokens SET active = FALSE WHERE expo_push_token = ANY($1::text[])",
      [tokens]
    );
    console.log(`[push] Desactivados ${tokens.length} tokens inválidos`);
  } catch (error) {
    console.error("[push] Error desactivando tokens:", error);
  }
}
