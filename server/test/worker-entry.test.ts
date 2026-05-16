import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeWorkerMock, startWorkerSchedulerMock, closePoolMock } =
  vi.hoisted(() => ({
    executeWorkerMock: vi.fn(),
    startWorkerSchedulerMock: vi.fn(),
    closePoolMock: vi.fn(),
  }));

vi.mock("../src/worker-runtime", () => ({
  executeWorker: executeWorkerMock,
  startWorkerScheduler: startWorkerSchedulerMock,
}));

vi.mock("../src/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryResult: vi.fn(),
  closePool: closePoolMock,
  checkDatabaseReady: vi.fn(),
  getPoolStats: vi.fn(),
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })) })),
    execute: vi.fn(() => Promise.resolve(undefined)),
  },
}));

describe("worker-entry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VITEST = "true";
  });

  it("ejecuta una sola corrida con --once y cierra recursos", async () => {
    executeWorkerMock.mockResolvedValue(undefined);
    closePoolMock.mockResolvedValue(undefined);

    const { runWorkerEntry } = await import("../src/worker-entry");
    await runWorkerEntry({
      argv: ["node", "worker-entry", "--once"],
      exitOnFinish: false,
    });

    expect(executeWorkerMock).toHaveBeenCalledTimes(1);
    expect(startWorkerSchedulerMock).not.toHaveBeenCalled();
    expect(closePoolMock).toHaveBeenCalledTimes(1);
  });

  it("inicia scheduler cuando no recibe --once", async () => {
    const { runWorkerEntry } = await import("../src/worker-entry");
    await runWorkerEntry({ argv: ["node", "worker-entry"], exitOnFinish: false });

    expect(startWorkerSchedulerMock).toHaveBeenCalledTimes(1);
    expect(executeWorkerMock).not.toHaveBeenCalled();
  });
});
