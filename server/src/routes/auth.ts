import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, queryOne } from "../db";
import { apiLogger } from "../observability/logger";
import { sendWelcomeEmail } from "../services/email";

const JWT_SECRET = process.env.JWT_SECRET || "notichilec-dev-secret-change-in-prod";
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "24h";

interface UserRow extends Record<string, unknown> {
  id: string;
  nombre: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function generateToken(user: { id: string; email: string; nombre: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

function sanitizeUser(row: UserRow) {
  return { id: row.id, nombre: row.nombre, email: row.email };
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

    const user = await queryOne<UserRow>(
      `INSERT INTO users (nombre, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, email, password_hash, created_at`,
      [nombre, email, passwordHash],
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

    res.status(201).json({
      user: sanitizeUser(user),
      token, // híbrido: web usa cookie, mobile usa token del body
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
      "SELECT id, nombre, email, password_hash, created_at FROM users WHERE email = $1",
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
      token, // híbrido
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
      "SELECT id, nombre, email, created_at FROM users WHERE id = $1",
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

export default router;
