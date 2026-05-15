import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render } from "emailmd";
import { Resend } from "resend";
import { apiLogger } from "../observability/logger";

// ── Config ──────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "NotiChileC <noreply@notichilec.com>";

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

// ── Senders ─────────────────────────────────────────

/**
 * Envía un email de bienvenida usando EmailMD + Resend.
 * Si RESEND_API_KEY no está configurada, solo loggea un warning.
 */
export async function sendWelcomeEmail(to: string, nombre: string): Promise<void> {
  if (!resend) {
    apiLogger.warn("email_skipped_no_api_key", { to });
    return;
  }

  try {
    const templatePath = resolve(TEMPLATES_DIR, "welcome.md");
    const raw = await readFile(templatePath, "utf-8");
    const markdown = fillTemplate(raw, { nombre, email: to });

    const { html, text } = await render(markdown, {
      theme: {
        fontFamily:
          "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
    });

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: "Bienvenido a NotiChileC",
      html,
      text,
    });

    if (error) {
      apiLogger.error("email_send_error", { to, error: JSON.stringify(error) });
      return;
    }

    apiLogger.info("email_sent_welcome", { to });
  } catch (err) {
    apiLogger.error("email_send_exception", {
      to,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}
