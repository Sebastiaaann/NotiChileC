import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render } from "emailmd";
import { Resend } from "resend";
import { apiLogger } from "../observability/logger";

// ── Config ──────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "NotiChileC <noreply@notichilec.com>";
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/** Root dir for templates: resolves from services/ to templates/ */
const TEMPLATES_DIR = resolve(__dirname, "../../templates/emails");

// ── Helpers ─────────────────────────────────────────

/** Replace {{key}} placeholders in template with values */
function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/** Render EmailMD template and send via Resend. Fire-and-forget pattern. */
async function renderAndSend(
  to: string,
  subject: string,
  templateName: string,
  vars: Record<string, string>,
): Promise<void> {
  if (!resend) {
    apiLogger.warn("email_skipped_no_api_key", { to, template: templateName });
    return;
  }

  try {
    const templatePath = resolve(TEMPLATES_DIR, templateName);
    const raw = await readFile(templatePath, "utf-8");
    const markdown = fillTemplate(raw, vars);

    const { html, text } = await render(markdown, {
      theme: {
        fontFamily:
          "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
    });

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      apiLogger.error("email_send_error", { to, template: templateName, error: JSON.stringify(error) });
      return;
    }

    apiLogger.info("email_sent", { to, template: templateName });
  } catch (err) {
    apiLogger.error("email_send_exception", {
      to,
      template: templateName,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

// ── Senders ─────────────────────────────────────────

/**
 * Envía un email de bienvenida usando EmailMD + Resend.
 * Si RESEND_API_KEY no está configurada, solo loggea un warning.
 */
export async function sendWelcomeEmail(to: string, nombre: string): Promise<void> {
  await renderAndSend(to, "Bienvenido a NotiChileC", "welcome.md", { nombre, email: to });
}

/**
 * Envía email de verificación con magic link + OTP.
 */
export async function sendVerificationEmail(
  to: string,
  nombre: string,
  token: string,
  otp: string,
): Promise<void> {
  const tokenUrl = `${BASE_URL}/verify?token=${encodeURIComponent(token)}`;
  await renderAndSend(to, "Verificá tu email en NotiChileC", "verification.md", {
    nombre,
    token_url: tokenUrl,
    otp,
    email: to,
  });
}

/**
 * Envía email de restablecimiento de contraseña con link.
 */
export async function sendPasswordResetEmail(
  to: string,
  nombre: string,
  token: string,
): Promise<void> {
  const resetUrl = `${BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await renderAndSend(to, "Restablecé tu contraseña en NotiChileC", "reset-password.md", {
    nombre,
    reset_url: resetUrl,
    email: to,
  });
}
