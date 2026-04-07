import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("archive storage config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("devuelve null cuando el export frío está desactivado en demo", async () => {
    process.env.DEMO_DISABLE_ARCHIVE_EXPORT = "true";
    process.env.ARCHIVE_BUCKET = "demo-bucket";

    const { getArchiveStorageConfig } = await import("../src/archive-storage");

    expect(getArchiveStorageConfig()).toBeNull();
  });

  it("devuelve config real cuando demo no desactiva el archive", async () => {
    process.env.ARCHIVE_BUCKET = "demo-bucket";
    process.env.ARCHIVE_PREFIX = "notichilec/archive";
    process.env.ARCHIVE_REGION = "us-east-1";

    const { getArchiveStorageConfig } = await import("../src/archive-storage");

    expect(getArchiveStorageConfig()).toEqual({
      bucket: "demo-bucket",
      prefix: "notichilec/archive",
      region: "us-east-1",
      endpoint: undefined,
    });
  });
});
