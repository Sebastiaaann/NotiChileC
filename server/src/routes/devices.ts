import { Router, type Request, type Response } from "express";
import { query } from "../db";

const router = Router();

interface RegisterBody {
  expoPushToken: string;
  platform?: string;
}

/**
 * POST /api/devices/register
 * Registra un token push de dispositivo. Hace upsert para evitar duplicados.
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { expoPushToken, platform } = req.body as RegisterBody;

    if (!expoPushToken || typeof expoPushToken !== "string") {
      res.status(400).json({
        error: "expoPushToken es requerido",
      });
      return;
    }

    // Validar formato básico de Expo Push Token
    if (!expoPushToken.startsWith("ExponentPushToken[")) {
      res.status(400).json({
        error: "Formato de token inválido. Debe ser ExponentPushToken[...]",
      });
      return;
    }

    await query(
      `INSERT INTO device_tokens (expo_push_token, platform, active, last_seen_at)
       VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (expo_push_token) DO UPDATE SET
         platform = EXCLUDED.platform,
         active = TRUE,
         last_seen_at = NOW()`,
      [expoPushToken, platform ?? "unknown"]
    );

    console.log(`[devices] Token registrado: ${expoPushToken.slice(0, 30)}... (${platform ?? "unknown"})`);

    res.json({ ok: true });
  } catch (error) {
    console.error("[devices] Error registrando token:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

/**
 * DELETE /api/devices/unregister
 * Desactiva un token push.
 */
router.delete("/unregister", async (req: Request, res: Response) => {
  try {
    const { expoPushToken } = req.body as { expoPushToken: string };

    if (!expoPushToken) {
      res.status(400).json({ error: "expoPushToken es requerido" });
      return;
    }

    await query(
      `UPDATE device_tokens SET active = FALSE WHERE expo_push_token = $1`,
      [expoPushToken]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("[devices] Error desregistrando token:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
