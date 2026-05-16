import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────

const { checkDatabaseReadyMock, getPoolStatsMock, dbSelectMock, dbInsertMock, dbUpdateMock } =
  vi.hoisted(() => ({
    checkDatabaseReadyMock: vi.fn(),
    getPoolStatsMock: vi.fn(),
    dbSelectMock: vi.fn(),
    dbInsertMock: vi.fn(),
    dbUpdateMock: vi.fn(),
  }));

// We'll capture mock references lazily via beforeAll
let sendWelcomeEmailMock: ReturnType<typeof vi.fn>;
let sendVerificationEmailMock: ReturnType<typeof vi.fn>;
let sendPasswordResetEmailMock: ReturnType<typeof vi.fn>;

vi.mock("../src/services/email", () => ({
  sendWelcomeEmail: vi.fn(() => Promise.resolve()),
  sendVerificationEmail: vi.fn(() => Promise.resolve()),
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/db", () => ({
  checkDatabaseReady: checkDatabaseReadyMock,
  getPoolStats: getPoolStatsMock,
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // Lazy thenable: when .limit() is called, it resolves. If no .limit() (OTP case),
          // the setTimeout fallback resolves via dbSelectMock.
          let resolved = false;
          let resolvePromise: (v: unknown) => void;
          const promise = new Promise(resolve => { resolvePromise = resolve; });
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolvePromise(dbSelectMock());
            }
          }, 0);
          return Object.assign(promise, {
            limit: vi.fn(() => {
              resolved = true;
              return Promise.resolve(dbSelectMock());
            }),
          });
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => dbInsertMock()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => dbUpdateMock()),
      })),
    })),
    execute: vi.fn(() => dbUpdateMock()),
  },
} as any));

// ── Helpers: auth-utils (pure functions) ───────────────

import {
  generateVerificationToken,
  generateResetToken,
  validateOtp,
} from "../src/services/auth-utils";

describe("auth-utils", () => {
  describe("generateVerificationToken", () => {
    it("generates a UUID v4 token and 6-char uppercase OTP with 10-min expiry", () => {
      const result = generateVerificationToken();

      // Token is a valid UUID v4
      expect(result.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // OTP = first 6 hex chars of UUID (uppercase, without dashes)
      const expectedOtp = result.token
        .replaceAll("-", "")
        .slice(0, 6)
        .toUpperCase();
      expect(result.otp).toBe(expectedOtp);
      expect(result.otp).toHaveLength(6);
      expect(result.otp).toMatch(/^[0-9A-F]{6}$/);

      // Expires at ~10 minutes from now
      const now = Date.now();
      const diffMs = result.expiresAt.getTime() - now;
      // Should be within 10 min ± 1s tolerance
      expect(diffMs).toBeGreaterThan(9 * 60 * 1000);
      expect(diffMs).toBeLessThan(11 * 60 * 1000);
    });

    it("generates unique tokens on successive calls", () => {
      const a = generateVerificationToken();
      const b = generateVerificationToken();
      expect(a.token).not.toBe(b.token);
      expect(a.otp).not.toBe(b.otp);
    });
  });

  describe("generateResetToken", () => {
    it("generates a UUID v4 token with 30-min expiry", () => {
      const result = generateResetToken();

      expect(result.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const now = Date.now();
      const diffMs = result.expiresAt.getTime() - now;
      expect(diffMs).toBeGreaterThan(29 * 60 * 1000);
      expect(diffMs).toBeLessThan(31 * 60 * 1000);
    });
  });

  describe("validateOtp", () => {
    it("returns true when provided OTP matches derived OTP from stored token", () => {
      const { token, otp } = generateVerificationToken();
      expect(validateOtp(otp, token)).toBe(true);
    });

    it("returns false when provided OTP does not match", () => {
      const { token } = generateVerificationToken();
      expect(validateOtp("ZZZZZZ", token)).toBe(false);
    });

    it("returns false for empty OTP", () => {
      const { token } = generateVerificationToken();
      expect(validateOtp("", token)).toBe(false);
    });

    it("is case-sensitive (OTP is uppercase)", () => {
      const { token, otp } = generateVerificationToken();
      expect(validateOtp(otp.toLowerCase(), token)).toBe(false);
    });
  });
});

// ── Integration: Auth Routes ───────────────────────────

import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "notichilec-dev-secret-change-in-prod";

/** Reset email mocks to return a resolved promise (needed for mockReset config) */
function setupEmailMocks() {
  if (sendWelcomeEmailMock) sendWelcomeEmailMock.mockResolvedValue(undefined);
  if (sendVerificationEmailMock) sendVerificationEmailMock.mockResolvedValue(undefined);
  if (sendPasswordResetEmailMock) sendPasswordResetEmailMock.mockResolvedValue(undefined);
}

// Capture mock references from the mocked module
beforeAll(async () => {
  const emailMod = await import("../src/services/email");
  sendWelcomeEmailMock = emailMod.sendWelcomeEmail as unknown as ReturnType<typeof vi.fn>;
  sendVerificationEmailMock = emailMod.sendVerificationEmail as unknown as ReturnType<typeof vi.fn>;
  sendPasswordResetEmailMock = emailMod.sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;
});

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("creates user, returns verified=false, sends verification email", async () => {
    dbSelectMock.mockResolvedValueOnce([]); // no existing user
    dbInsertMock.mockResolvedValueOnce([{
      // inserted user
      id: "user-1",
      nombre: "Test User",
      email: "test@example.com",
      password_hash: "hashed",
      created_at: new Date().toISOString(),
      email_verified_at: null,
      verification_token: "abc-123",
      verification_token_expires_at: new Date(
        Date.now() + 10 * 60 * 1000,
      ).toISOString(),
    }]);

    const { createApp } = await import("../src/app");
    const app = createApp();

    const response = await request(app)
      .post("/api/auth/register")
      .send({ nombre: "Test User", email: "test@example.com", password: "password123" });

    expect(response.status).toBe(201);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.nombre).toBe("Test User");
    expect(response.body.user.email).toBe("test@example.com");
    expect(response.body.verified).toBe(false);
    expect(response.body.token).toBeTruthy();

    // Verification email mock is resilient: give microtask queue time
    await vi.waitFor(() => {
      expect(sendVerificationEmailMock).toHaveBeenCalledWith(
        "test@example.com",
        "Test User",
        expect.any(String),
        expect.any(String),
      );
    });
  });

  it("returns 409 for duplicate email", async () => {
    dbSelectMock.mockResolvedValueOnce([{ id: "existing" }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/register")
      .send({ nombre: "Dupe", email: "exists@example.com", password: "password123" });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("ya está registrado");
  });

  it("returns 400 for missing fields", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/register")
      .send({ email: "only@email.com" });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("returns verified=true when email_verified_at is set", async () => {
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test User",
      email: "test@example.com",
      password_hash: await bcrypt.hash("password123", 10),
      created_at: new Date().toISOString(),
      email_verified_at: new Date().toISOString(),
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
  });

  it("returns verified=false when email_verified_at is null", async () => {
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-2",
      nombre: "Unverified",
      email: "unverified@example.com",
      password_hash: await bcrypt.hash("password123", 10),
      created_at: new Date().toISOString(),
      email_verified_at: null,
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ email: "unverified@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(false);
  });

  it("returns 401 for wrong password", async () => {
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      password_hash: await bcrypt.hash("rightpass", 10),
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "wrongpass" });

    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/verify/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("verifies with magic link token", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test",
      email: "test@example.com",
      email_verified_at: null,
      verification_token: "valid-token-uuid",
      verification_token_expires_at: futureExpiry,
    }]);
    dbUpdateMock.mockResolvedValueOnce(undefined);
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test",
      email: "test@example.com",
      email_verified_at: new Date().toISOString(),
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/confirm")
      .send({ token: "valid-token-uuid" });

    expect(response.status).toBe(200);
    expect(response.body.user.email_verified_at).toBeTruthy();
  });

  it("verifies with OTP", async () => {
    // Create a token with a known OTP derivation
    const tokenUuid = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";
    const expectedOtp = "A1B2C3"; // first 6 hex chars, uppercase, no dashes

    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    // OTP: select all pending verification users
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-1",
        nombre: "Test",
        email: "test@example.com",
        email_verified_at: null,
        verification_token: tokenUuid,
        verification_token_expires_at: futureExpiry,
      },
    ]);
    dbUpdateMock.mockResolvedValueOnce(undefined);
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test",
      email: "test@example.com",
      email_verified_at: new Date().toISOString(),
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/confirm")
      .send({ otp: expectedOtp });

    expect(response.status).toBe(200);
    expect(response.body.user.email_verified_at).toBeTruthy();
  });

  it("returns 410 for expired token", async () => {
    const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      email_verified_at: null,
      verification_token: "expired-token-uuid",
      verification_token_expires_at: pastExpiry,
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/confirm")
      .send({ token: "expired-token-uuid" });

    expect(response.status).toBe(410);
    expect(response.body.expired).toBe(true);
  });

  it("returns 400 when no token or OTP provided", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/confirm")
      .send({});

    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/verify/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("sends new verification email for authenticated user", async () => {
    dbUpdateMock.mockResolvedValueOnce(undefined);

    const token = jwt.sign(
      { id: "user-1", email: "test@example.com", nombre: "Test" },
      JWT_SECRET,
    );

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/send")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    // Should have called update to set verification_token
    expect(dbUpdateMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(sendVerificationEmailMock).toHaveBeenCalled();
    });
  });

  it("returns 429 for rate-limited resend within 60s", async () => {
    dbUpdateMock.mockResolvedValueOnce(undefined);

    const token = jwt.sign(
      { id: "user-2", email: "rate@example.com", nombre: "Rate" },
      JWT_SECRET,
    );

    const { createApp } = await import("../src/app");
    const app = createApp();

    // First send
    await request(app)
      .post("/api/auth/verify/send")
      .set("Authorization", `Bearer ${token}`)
      .send();

    // Second send within 60s
    const response = await request(app)
      .post("/api/auth/verify/send")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(response.status).toBe(429);
    expect(response.body.retryAfter).toBeDefined();
  });

  it("returns 401 without auth token", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/verify/send")
      .send();

    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("always returns 200 even if email does not exist", async () => {
    dbSelectMock.mockResolvedValueOnce([]); // user not found

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/forgot-password")
      .send({ email: "nonexistent@example.com" });

    expect(response.status).toBe(200);
    // Should NOT call sendPasswordResetEmail for non-existent user
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it("sends reset email when user exists", async () => {
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test",
      email: "test@example.com",
    }]);
    dbUpdateMock.mockResolvedValueOnce(undefined);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/forgot-password")
      .send({ email: "test@example.com" });

    expect(response.status).toBe(200);
    // Should have updated reset_token in DB
    expect(dbUpdateMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
        "test@example.com",
        "Test",
        expect.any(String),
      );
    });
  });

  it("returns 400 for missing email", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/forgot-password")
      .send({});

    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHealthMocks();
    setupEmailMocks();
  });

  it("resets password with valid token", async () => {
    const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      nombre: "Test",
      email: "test@example.com",
      password_hash: await bcrypt.hash("oldpassword", 10),
      reset_token: "valid-reset-token",
      reset_token_expires_at: futureExpiry,
    }]);
    dbUpdateMock.mockResolvedValueOnce(undefined);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/reset-password")
      .send({ token: "valid-reset-token", newPassword: "newpassword123" });

    expect(response.status).toBe(200);
    // Should update password and clear reset fields
    expect(dbUpdateMock).toHaveBeenCalled();
  });

  it("returns 401 for invalid token", async () => {
    dbSelectMock.mockResolvedValueOnce([]); // no matching reset token

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/reset-password")
      .send({ token: "invalid-token", newPassword: "newpassword123" });

    expect(response.status).toBe(401);
  });

  it("returns 401 for expired token", async () => {
    const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();
    dbSelectMock.mockResolvedValueOnce([{
      id: "user-1",
      reset_token: "expired-token",
      reset_token_expires_at: pastExpiry,
    }]);

    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/reset-password")
      .send({ token: "expired-token", newPassword: "newpassword123" });

    expect(response.status).toBe(401);
  });

  it("returns 400 for missing fields", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp())
      .post("/api/auth/reset-password")
      .send({ token: "some-token" });

    expect(response.status).toBe(400);
  });
});

// ── Helper ─────────────────────────────────────────────

function setupHealthMocks() {
  checkDatabaseReadyMock.mockResolvedValue({
    ok: true,
    durationMs: 5,
    stats: { totalCount: 1, idleCount: 1, waitingCount: 0, maxConnections: 4 },
  });
  getPoolStatsMock.mockReturnValue({
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    maxConnections: 4,
  });
}
