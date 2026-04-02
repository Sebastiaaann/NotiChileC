import { Router, type Request, type Response } from "express";
import { query } from "../db";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";
import { registerLegacyDeviceFromToken } from "./installations";

const router = Router();

interface RegisterBody {
  expoPushToken: string;
  platform?: string;
}

/**
 * POST /api/devices/register
 * Alias temporal para compatibilidad con clientes legacy.
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

    if (!expoPushToken.startsWith("ExponentPushToken[")) {
      res.status(400).json({
        error: "Formato de token inválido. Debe ser ExponentPushToken[...]",
      });
      return;
    }

    await registerLegacyDeviceFromToken(expoPushToken, platform);

    apiLogger.info("legacy_device_registered", {
      route: "/api/devices/register",
      token_prefix: expoPushToken.slice(0, 30),
      platform: platform ?? "legacy",
    });

    res.json({ ok: true });
  } catch (error) {
    captureException(error, { route: "/api/devices/register", method: "POST" });
    apiLogger.error("legacy_device_register_failed", {
      route: "/api/devices/register",
      error_code: "legacy_device_register_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
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
      `UPDATE device_tokens
       SET active = FALSE,
           last_seen_at = NOW()
       WHERE expo_push_token = $1`,
      [expoPushToken]
    );

    await query(
      `UPDATE device_installations
       SET active = FALSE,
           invalidated_at = NOW(),
           invalid_reason = 'legacy-unregister',
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE push_token = $1`,
      [expoPushToken]
    );

    res.json({ ok: true });
  } catch (error) {
    captureException(error, { route: "/api/devices/unregister", method: "DELETE" });
    apiLogger.error("legacy_device_unregister_failed", {
      route: "/api/devices/unregister",
      error_code: "legacy_device_unregister_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
