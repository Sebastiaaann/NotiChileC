import { beforeEach, describe, expect, it, vi } from "vitest";

const { startApiServerMock } = vi.hoisted(() => ({
  startApiServerMock: vi.fn(),
}));

vi.mock("../src/api-server", () => ({
  startApiServer: startApiServerMock,
}));

describe("api entry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VITEST = "true";
  });

  it("expone un arranque API-only sin scheduler", async () => {
    startApiServerMock.mockReturnValue({ close: vi.fn() });

    const { startApiProcess } = await import("../src/api");
    const server = startApiProcess();

    expect(startApiServerMock).toHaveBeenCalledTimes(1);
    expect(server).toBeDefined();
  });
});
