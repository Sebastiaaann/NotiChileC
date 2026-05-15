-- Migration: 002_add_auth_verification
-- Adds email verification and password reset columns to users table.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_token TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- Flag all existing users as verified (pre-launch assumption)
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;
