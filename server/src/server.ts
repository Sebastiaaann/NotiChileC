import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import devicesRouter from "./routes/devices";
import licitacionesRouter from "./routes/licitaciones";
import { runSyncCycle } from "./worker";
import { closePool } from "./db";

const PORT = Number(process.env.PORT) || 3000;
const WORKER_INTERVAL = Number(process.env.WORKER_INTERVAL_MINUTES) || 2;

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/devices", devicesRouter);
app.use("/api/licitaciones", licitacionesRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Worker cron ─────────────────────────────────────

let workerRunning = false;

async function executeWorker() {
  if (workerRunning) {
    console.log("[cron] Worker ya está ejecutándose, saltando...");
    return;
  }

  workerRunning = true;
  try {
    await runSyncCycle();
  } catch (error) {
    console.error("[cron] Error en worker:", error);
  } finally {
    workerRunning = false;
  }
}

// Ejecutar cada N minutos
const cronExpression = `*/${WORKER_INTERVAL} * * * *`;
cron.schedule(cronExpression, executeWorker);

console.log(`[cron] Worker programado cada ${WORKER_INTERVAL} minutos`);

// Ejecutar inmediatamente al iniciar
setTimeout(() => {
  console.log("[cron] Ejecutando primera sincronización...");
  executeWorker();
}, 3000);

// ── Server start ────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] API corriendo en http://localhost:${PORT}`);
  console.log(`[server] Endpoints:`);
  console.log(`  POST /api/devices/register`);
  console.log(`  GET  /api/licitaciones`);
  console.log(`  GET  /api/licitaciones/:id`);
  console.log(`  GET  /api/health`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\n[server] Cerrando...");
  server.close();
  await closePool();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
