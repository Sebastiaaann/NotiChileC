describe("api demo fallback", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("usa fallback curado directo en demo fallback", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "demo";
    process.env.EXPO_PUBLIC_DEMO_DATA_MODE = "fallback";

    const { fetchLicitaciones } = require("../../services/api");

    const response = await fetchLicitaciones({ limit: 20, cursor: null });

    expect(response.data.length).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cae al fallback curado en demo hybrid cuando el feed real vuelve vacío", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "demo";
    process.env.EXPO_PUBLIC_DEMO_DATA_MODE = "hybrid";

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        pageInfo: {
          limit: 20,
          hasMore: false,
          nextCursor: null,
          windowDays: 90,
          windowStart: "2026-01-01T00:00:00.000Z",
        },
      }),
    });

    const { fetchLicitaciones } = require("../../services/api");

    const response = await fetchLicitaciones({ limit: 20, cursor: null });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(response.data.length).toBeGreaterThan(0);
  });

  it("cae al detalle curado en demo hybrid si el backend falla", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "demo";
    process.env.EXPO_PUBLIC_DEMO_DATA_MODE = "hybrid";

    (global.fetch as jest.Mock).mockRejectedValue(new Error("backend down"));

    const { fetchLicitacion } = require("../../services/api");

    const response = await fetchLicitacion("demo-licitacion-001");

    expect(response.data.id).toBe("demo-licitacion-001");
  });
});
