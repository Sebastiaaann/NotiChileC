import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { sql } from "drizzle-orm";

const JWT_SECRET =
  process.env.JWT_SECRET || "notichilec-dev-secret-change-in-prod";

/**
 * Express middleware that rejects unverified users with 403.
 * Extracts user from JWT (cookie or Bearer header), queries email_verified_at,
 * and blocks access if the user hasn't verified their email.
 */
export async function requireVerifiedEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let token: string | undefined;

    if (req.cookies?.session) {
      token = req.cookies.session;
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      res.status(401).json({ message: "No autorizado" });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      nombre: string;
    };

    // Attach user to request for downstream handlers
    (req as unknown as Record<string, unknown>).user = decoded;

    const result = await db.execute<{ email_verified_at: string | null }>(
      sql`SELECT email_verified_at FROM users WHERE id = ${decoded.id}`
    );
    const row = result.rows[0] ?? null;

    if (!row || !row.email_verified_at) {
      res.status(403).json({
        needsVerification: true,
        message: "Email no verificado",
      });
      return;
    }

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: "Token inválido o expirado" });
      return;
    }
    res.status(500).json({ message: "Error interno del servidor" });
  }
}
