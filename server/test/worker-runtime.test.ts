import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduleMock,
  runIngestCycleMock,
  runDispatchCycleMock,
  runReceiptCycleMock,
  runCleanupCycleMock,
  runArchiveExportCycleMock,
} = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  runIngestCycleMock: vi.fn(),
  runDispatchCycleMock: vi.fn(),
  runReceiptCycleMock: vi.fn(),
  runCleanupCycleMock: vi.fn(),
  runArchiveExportCycleMock: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: scheduleMock,
  },
}));

vi.mock("../src/worker", () => ({
  runIngestCycle: runIngestCycleMock,
  runDispatchCycle: runDispatchCycleMock,
  runReceiptCycle: runReceiptCycleMock,
  runCleanupCycle: runCleanupCycleMock,
  runArchiveExportCycle: runArchiveExportCycleMock,
}));

describe("worker-runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    scheduleMock.mockReturnValue({ stop: vi.fn() });
  });

  it("agenda cron con el intervalo pedido", async () => {
    const { startWorkerScheduler } = await import("../src/worker-runtime");

    startWorkerScheduler({ intervalMinutes: 5, runImmediately: false });

    expect(scheduleMock).toHaveBeenCalledWith("*/5 * * * *", expect.any(Function));
    expect(scheduleMock).toHaveBeenCalledWith("*/1 * * * *", expect.any(Function));
    expect(scheduleMock).toHaveBeenCalledWith("17 3 * * *", expect.any(Function));
    expect(scheduleMock).toHaveBeenCalledWith("47 3 * * *", expect.any(Function));
  });

  it("dispara una corrida inmediata cuando runImmediately está activo", async () => {
    runIngestCycleMock.mockResolvedValue(undefined);
    runDispatchCycleMock.mockResolvedValue(undefined);
    runReceiptCycleMock.mockResolvedValue(undefined);
    runCleanupCycleMock.mockResolvedValue(undefined);
    runArchiveExportCycleMock.mockResolvedValue(undefined);
    const { startWorkerScheduler } = await import("../src/worker-runtime");

    startWorkerScheduler({ intervalMinutes: 2, runImmediately: true });
    await vi.advanceTimersByTimeAsync(3000);

    expect(runIngestCycleMock).toHaveBeenCalledTimes(1);
    expect(runDispatchCycleMock).toHaveBeenCalledTimes(1);
    expect(runReceiptCycleMock).toHaveBeenCalledTimes(1);
    expect(runCleanupCycleMock).toHaveBeenCalledTimes(1);
    expect(runArchiveExportCycleMock).toHaveBeenCalledTimes(1);
  });

  it("no ejecuta workers del mismo tipo en paralelo", async () => {
    let resolveRun!: () => void;
    runIngestCycleMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        })
    );
    runDispatchCycleMock.mockResolvedValue(undefined);
    runReceiptCycleMock.mockResolvedValue(undefined);
    runCleanupCycleMock.mockResolvedValue(undefined);
    runArchiveExportCycleMock.mockResolvedValue(undefined);

    const { executeIngestWorker } = await import("../src/worker-runtime");

    const firstRun = executeIngestWorker();
    const secondRun = executeIngestWorker();
    await Promise.resolve();

    expect(runIngestCycleMock).toHaveBeenCalledTimes(1);

    resolveRun();
    await firstRun;
    await secondRun;
  });
});
