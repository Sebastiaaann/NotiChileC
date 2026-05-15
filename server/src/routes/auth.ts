import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, queryOne } from "../db";
import { apiLogger } from "../observability/logger";
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from "../services/email";
import { generateVerificationToken, generateResetToken, validateOtp } from "../services/auth-utils";

const JWT_SECRET = process.env.JWT_SECRET || "notichilec-dev-secret-change-in-prod";
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "24h";

interface UserRow extends Record<string, unknown> {
  id: string;
  nombre: string;
  email: string;
  password_hash: string;
  created_at: string;
  email_verified_at: string | null;
  verification_token: string | null;
  verification_token_expires_at: string | null;
  reset_token: string | null;
  reset_token_expires_at: string | null;
}

// ── Rate limiting (in-memory) ────────────────────────

/** Track last verification email send per user email */
const verifyCooldowns = new Map<string, number>();
const VERIFY_COOLDOWN_MS = 60_000; // 60 seconds

function checkVerifyRateLimit(email: string): { allowed: boolean; retryAfter: number } {
  const lastSent = verifyCooldowns.get(email);
  const now = Date.now();
  if (lastSent && now - lastSent < VERIFY_COOLDOWN_MS) {
    return { allowed: false, retryAfter: Math.ceil((VERIFY_COOLDOWN_MS - (now - lastSent)) / 1000) };
  }
  verifyCooldowns.set(email, now);
  return { allowed: true, retryAfter: 0 };
}

// ── Helpers ──────────────────────────────────────────

function generateToken(user: { id: string; email: string; nombre: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

function sanitizeUser(row: UserRow) {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    email_verified_at: row.email_verified_at ?? null,
  };
}

function setTokenCookie(res: Response, token: string) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("session", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24, // 24h
    path: "/",
  });
}

function clearTokenCookie(res: Response) {
  res.cookie("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/** Extract token from cookie first, fallback to Bearer header (hybrid for mobile future) */
function extractToken(req: Request): string | null {
  if (req.cookies?.session) return req.cookies.session;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

/** Decode JWT and return user payload or null */
function extractUserFromToken(req: Request): { id: string; email: string; nombre: string } | null {
  const token = extractToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string; nombre: string };
  } catch {
    return null;
  }
}

const router = Router();

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password) {
      res.status(400).json({ message: "Nombre, email y contraseña son requeridos" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }

    const existing = await queryOne<UserRow>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (existing) {
      res.status(409).json({ message: "El email ya está registrado" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { token: verificationToken, otp, expiresAt } = generateVerificationToken();

    const user = await queryOne<UserRow>(
      `INSERT INTO users (nombre, email, password_hash, verification_token, verification_token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, email, password_hash, created_at, email_verified_at, verification_token, verification_token_expires_at`,
      [nombre, email, passwordHash, verificationToken, expiresAt.toISOString()],
    );

    if (!user) {
      res.status(500).json({ message: "Error al crear usuario" });
      return;
    }

    const token = generateToken(user);
    setTokenCookie(res, token);

    apiLogger.info("user_registered", { user_id: user.id, email: user.email });

    // Fire-and-forget: no bloqueamos la respuesta
    sendWelcomeEmail(user.email, user.nombre).catch((err) =>
      apiLogger.error("welcome_email_failed", {
        user_id: user.id,
        error: err instanceof Error ? err : new Error(String(err)),
      }),
    );

    sendVerificationEmail(user.email, user.nombre, verificationToken, otp).catch((err) =>
      apiLogger.error("verification_email_failed", {
        user_id: user.id,
        error: err instanceof Error ? err : new Error(String(err)),
      }),
    );

    res.status(201).json({
      user: sanitizeUser(user),
      token, // híbrido: web usa cookie, mobile usa token del body
      verified: false,
    });
  } catch (error) {
    apiLogger.error("auth_register_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email y contraseña son requeridos" });
      return;
    }

    const user = await queryOne<UserRow>(
      "SELECT id, nombre, email, password_hash, created_at, email_verified_at FROM users WHERE email = $1",
      [email],
    );

    if (!user) {
      res.status(401).json({ message: "Email o contraseña incorrectos" });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ message: "Email o contraseña incorrectos" });
      return;
    }

    const token = generateToken(user);
    setTokenCookie(res, token);

    apiLogger.info("user_logged_in", { user_id: user.id, email: user.email });

    res.json({
      user: sanitizeUser(user),
      token,
      verified: user.email_verified_at !== null,
    });
  } catch (error) {
    apiLogger.error("auth_login_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// GET /api/auth/session
router.get("/session", async (req: Request, res: Response) => {
  try {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({ message: "No autorizado" });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; nombre: string };

    const user = await queryOne<UserRow>(
      "SELECT id, nombre, email, created_at, email_verified_at FROM users WHERE id = $1",
      [decoded.id],
    );

    if (!user) {
      res.status(401).json({ message: "Usuario no encontrado" });
      return;
    }

    res.json(sanitizeUser(user));
  } catch {
    res.status(401).json({ message: "Token inválido o expirado" });
  }
});

// POST /api/auth/logout
router.post("/logout", (_req: Request, res: Response) => {
  clearTokenCookie(res);
  res.json({ message: "Sesión cerrada" });
});

// POST /api/auth/verify/send
router.post("/verify/send", async (req: Request, res: Response) => {
  try {
    const decoded = extractUserFromToken(req);

    if (!decoded) {
      res.status(401).json({ message: "No autorizado" });
      return;
    }

    const rateCheck = checkVerifyRateLimit(decoded.email);
    if (!rateCheck.allowed) {
      res.status(429).json({ message: "Esperá antes de solicitar otro código", retryAfter: rateCheck.retryAfter });
      return;
    }

    const { token: verificationToken, otp, expiresAt } = generateVerificationToken();

    await query(
      `UPDATE users SET verification_token = $1, verification_token_expires_at = $2 WHERE id = $3`,
      [verificationToken, expiresAt.toISOString(), decoded.id],
    );

    // Fire-and-forget
    sendVerificationEmail(decoded.email, decoded.nombre, verificationToken, otp).catch((err) =>
      apiLogger.error("resend_verification_email_failed", {
        user_id: decoded.id,
        error: err instanceof Error ? err : new Error(String(err)),
      }),
    );

    res.json({ message: "Email de verificación enviado" });
  } catch (error) {
    apiLogger.error("verify_send_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/verify/confirm
router.post("/verify/confirm", async (req: Request, res: Response) => {
  try {
    const { token: providedToken, otp: providedOtp } = req.body;

    if (!providedToken && !providedOtp) {
      res.status(400).json({ message: "Token u OTP requerido" });
      return;
    }

    if (providedOtp) {
      // We need to search all users with non-null verification_token and check OTP match
      // Fetch users who have a pending verification token
      const pendingUsers = await query<UserRow>(
        `SELECT id, nombre, email, email_verified_at, verification_token, verification_token_expires_at
         FROM users
         WHERE verification_token IS NOT NULL AND verification_token_expires_at IS NOT NULL`,
      );

      const matchedUser = pendingUsers.find((u) => {
        if (!u.verification_token) return false;
        return validateOtp(providedOtp, u.verification_token);
      });

      if (!matchedUser) {
        res.status(400).json({ message: "Código inválido o expirado" });
        return;
      }

      // Check expiry
      if (matchedUser.verification_token_expires_at && new Date(matchedUser.verification_token_expires_at) < new Date()) {
        res.status(410).json({ expired: true, message: "El código de verificación expiró" });
        return;
      }

      await query(
        `UPDATE users SET email_verified_at = NOW(), verification_token = NULL, verification_token_expires_at = NULL WHERE id = $1`,
        [matchedUser.id],
      );

      const updated = await queryOne<UserRow>(
        `SELECT id, nombre, email, email_verified_at FROM users WHERE id = $1`,
        [matchedUser.id],
      );

      apiLogger.info("email_verified_by_otp", { user_id: matchedUser.id });

      res.json({ message: "Email verificado correctamente", user: sanitizeUser(updated!) });
      return;
    }

    // Token-based verification
    const user = await queryOne<UserRow>(
      `SELECT id, nombre, email, email_verified_at, verification_token, verification_token_expires_at
       FROM users WHERE verification_token = $1`,
       [providedToken!],
    );

    if (!user) {
      res.status(400).json({ message: "Token inválido o expirado" });
      return;
    }

    if (user.verification_token_expires_at && new Date(user.verification_token_expires_at) < new Date()) {
      res.status(410).json({ expired: true, message: "El token de verificación expiró" });
      return;
    }

    await query(
      `UPDATE users SET email_verified_at = NOW(), verification_token = NULL, verification_token_expires_at = NULL WHERE id = $1`,
      [user.id],
    );

    const updated = await queryOne<UserRow>(
      `SELECT id, nombre, email, email_verified_at FROM users WHERE id = $1`,
      [user.id],
    );

    apiLogger.info("email_verified", { user_id: user.id });

    res.json({ message: "Email verificado correctamente", user: sanitizeUser(updated!) });
  } catch (error) {
    apiLogger.error("verify_confirm_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email requerido" });
      return;
    }

    // Always return 200 to prevent email enumeration
    const user = await queryOne<UserRow>(
      "SELECT id, nombre, email FROM users WHERE email = $1",
      [email],
    );

    if (user) {
      const { token: resetToken, expiresAt } = generateResetToken();

      await query(
        `UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3`,
        [resetToken, expiresAt.toISOString(), user.id],
      );

      sendPasswordResetEmail(user.email, user.nombre, resetToken).catch((err) =>
        apiLogger.error("reset_password_email_failed", {
          user_id: user.id,
          error: err instanceof Error ? err : new Error(String(err)),
        }),
      );
    }

    res.json({ message: "Si el email está registrado, recibirás un link para restablecer tu contraseña" });
  } catch (error) {
    apiLogger.error("forgot_password_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ message: "Token y nueva contraseña requeridos" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }

    const user = await queryOne<UserRow>(
      `SELECT id, nombre, email, reset_token, reset_token_expires_at
       FROM users WHERE reset_token = $1`,
      [token],
    );

    if (!user) {
      res.status(401).json({ message: "Token inválido o expirado" });
      return;
    }

    if (user.reset_token_expires_at && new Date(user.reset_token_expires_at) < new Date()) {
      res.status(401).json({ message: "Token inválido o expirado" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE id = $2`,
      [passwordHash, user.id],
    );

    apiLogger.info("password_reset_completed", { user_id: user.id });

    res.json({ message: "Contraseña restablecida correctamente" });
  } catch (error) {
    apiLogger.error("reset_password_error", {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

export default router;
