import { randomUUID } from "node:crypto";

export interface VerificationTokenResult {
  token: string;
  otp: string;
  expiresAt: Date;
}

export interface ResetTokenResult {
  token: string;
  expiresAt: Date;
}

/**
 * Generate a verification token + OTP.
 * - token = UUID v4
 * - otp = first 6 hex chars of UUID (uppercase, no dashes)
 * - expiresAt = now + 10 minutes
 */
export function generateVerificationToken(): VerificationTokenResult {
  const token = randomUUID();
  const otp = token.replaceAll("-", "").slice(0, 6).toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  return { token, otp, expiresAt };
}

/**
 * Generate a reset token.
 * - token = UUID v4
 * - expiresAt = now + 30 minutes
 */
export function generateResetToken(): ResetTokenResult {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  return { token, expiresAt };
}

/**
 * Validate a provided OTP against a stored verification token.
 * Derives the expected OTP from the stored token (first 6 hex chars, uppercase)
 * and compares with the provided OTP.
 */
export function validateOtp(providedOtp: string, storedToken: string): boolean {
  const expectedOtp = storedToken.replaceAll("-", "").slice(0, 6).toUpperCase();
  return providedOtp === expectedOtp;
}
