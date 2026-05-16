---
name: notichilec-backend-architecture
description: >
  Arquitectura del backend de NotiChileC. Server layers, patrones de idempotencia,
  degradación graceful, separación de workloads (API vs worker), y dependency injection.
  Trigger: Modificar server, rutas, DB tier, o entender separación API/worker.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Modificar `server/src/app.ts`, `api-server.ts`, `server.ts` o cualquier ruta en `routes/`
- Agregar/quitar middleware global o handlers de error
- Cambiar la capa de base de datos (`db.ts`)
- Decidir dónde poner nueva lógica: ¿API endpoint, worker, o helper compartido?
- Refactorizar separación de responsabilidades entre API y worker
- Debuggear errores de conexión DB, pool saturation, o timeouts

## Server Layers

La API sigue 3 capas:

```
┌────────────────────────────────────────────┐
│  1. Bootstrap (server.ts)                  │
│     inicia app + worker + shutdown hooks   │
├────────────────────────────────────────────┤
│  2. Express App (app.ts)                   │
│     middleware global, health checks,      │
│     route mounting, error handler          │
├────────────────────────────────────────────┤
│  3. Routes (routes/*.ts)                   │
│     handlers específicos por recurso       │
│     fetch → validate → respond             │
└────────────────────────────────────────────┘
```

### 1. Bootstrap (`server.ts`)

Punto de entrada combinado. Inicia API + worker en el mismo proceso:

```typescript
// server/src/server.ts
export function startCombinedProcess() {
  initSentry("notichilec-combined");
  const server = startApiServer();          // API HTTP
  const workerTask = startWorkerScheduler(); // worker cron
  return { server, workerTask };
}
```

- `startApiServer()` en `api-server.ts` levanta Express puro (sin worker)
- `startCombinedProcess()` levanta ambos para desarrollo/producción
- Shutdown graceful: stop worker → close server → close pool → flush Sentry

### 2. Express App (`app.ts`)

Crea la aplicación Express con:

```typescript
// app.ts — createApp()
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestLoggingMiddleware); // x-request-id + métricas
```

Endpoints de health:
- `GET /api/health/live` — liveness check (sin DB)
- `GET /api/health/ready` — readiness check (con DB, devuelve 503 si falla)
- `GET /api/health` — health general

Route mounting:
```typescript
app.use("/api/installations", installationsRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/licitaciones", licitacionesRouter);
app.use("/api/rubros", rubrosRouter);
```

Error handler unificado — captura toda excepción no manejada, devuelve JSON consistente:
```typescript
res.status(500).json({
  status: "error",
  message,
  requestId,
});
```

### 3. Routes (`routes/*.ts`)

Cada route module sigue el patrón **fetch → validate → respond**:

```typescript
// Pseudopatrón de cada handler
router.get("/", async (req: Request, res: Response) => {
  try {
    // 1. VALIDATE: leer y sanitizar parámetros
    const limit = readLimit(req);
    const cursor = decodeCursor(req.query.cursor);

    // 2. FETCH: consultar DB
    const rows = await query<RowType>(`SELECT ...`, params);

    // 3. RESPOND: formatear y devolver
    res.json({ data: rows, pageInfo: { ... } });
  } catch (error) {
    // 4. ERROR: log + Sentry + JSON consistente
    captureException(error, { route: "/api/..." });
    res.status(500).json({ error: "Error interno" });
  }
});
```

**Reglas:**
- `GET` endpoints NUNCA mutan estado — son read-only
- Validar tipos en frontera: `readLimit()`, `readFilters()`, `decodeCursor()`
- Usar `captureException()` + `apiLogger.error()` en cada catch
- Siempre devolver JSON, nunca HTML o texto plano

## DB Tier (`db.ts`)

La capa de base de datos usa `pg.Pool` con las siguientes helpers:

| Función | Propósito |
|---------|-----------|
| `query<T>(text, params)` | Retorna `T[]` (rows) |
| `queryOne<T>(text, params)` | Retorna `T \| null` (primer row) |
| `queryResult<T>(text, params)` | Retorna `QueryResult<T>` completo (acceso a `rowCount`, `fields`) |
| `getPool()` | Pool singleton (reuse) |
| `createDirectPool(name)` | Pool nuevo para migraciones/archivo |
| `getPoolStats()` | Obtener stats del pool |
| `checkDatabaseReady()` | Health check con timeout |
| `closePool()` | Cerrar pool (shutdown) |

Configuración del pool:
```typescript
max: 4,                    // DB_POOL_MAX
idleTimeoutMillis: 30_000, // DB_IDLE_TIMEOUT_MS
connectionTimeoutMillis: 5_000, // DB_CONNECTION_TIMEOUT_MS
maxUses: 7_500,
application_name: "notichilec-runtime",
```

Timeout de readiness: 1500ms (`DB_READINESS_TIMEOUT_MS`).

**Pool saturation detection:**
```typescript
if (stats.waitingCount > 0 && stats.totalCount >= stats.maxConnections) {
  return { ok: false, reason: "pool_saturated", ... };
}
```

## Idempotency: `ON CONFLICT DO NOTHING`

Usamos `ON CONFLICT DO NOTHING` para deduplicación en múltiples puntos:

```sql
-- Licitacion registry: evitar duplicar codigos
ON CONFLICT (codigo_externo) DO NOTHING

-- Notification deliveries: mismo evento + instalación = 1 delivery
ON CONFLICT (notification_event_id, installation_id) DO NOTHING

-- Installation upsert: INSERT con DO NOTHING, después UPDATE
ON CONFLICT (installation_id) DO NOTHING

-- Rubros seed: no duplicar inserts iniciales
ON CONFLICT (code) DO NOTHING
```

Para **upserts** (insertar o actualizar si existe):
```sql
ON CONFLICT (codigo_externo) DO UPDATE SET updated_at = EXCLUDED.updated_at;
ON CONFLICT (installation_id) DO UPDATE SET push_token = EXCLUDED.push_token, ...;
```

**Regla**: Siempre preferir `ON CONFLICT DO NOTHING` para el path rápido,
y `ON CONFLICT DO UPDATE` solo cuando necesitamos mergear datos nuevos.

## Graceful Degradation

El scraper y la API de ChileCompra pueden fallar sin romper el servidor:

### Scraper failure no afecta API

```typescript
// worker.ts — ingest cycle
try {
  const scrapeResult = await scrapeLicitaciones(20);
  // ... procesar scrape ...
} catch (error) {
  workerLogger.error("scraper_failed", { ... });
  // NO relanzar — el ciclo continúa con API ChileCompra
}

try {
  const todaySummaries = await fetchLicitacionesSummary(today);
  // ... procesar API ...
  consecutiveFailures = 0;
} catch (error) {
  consecutiveFailures++;
  workerLogger.warn("api_unavailable_during_ingest", { ... });
}
```

### Readiness check expone degradación

```typescript
// app.ts — GET /api/health/ready
const readiness = await checkDatabaseReady();
res.status(readiness.ok ? 200 : 503).json({
  status: readiness.ok ? "ok" : "degraded",
  db: { ok: readiness.ok, reason: readiness.reason, ... },
});
```

**Reglas:**
- Cada try/catch en el worker es independiente — una fuente falla, las otras siguen
- `consecutiveFailures` contador global para alertas (no bloquea)
- La API sirve licitaciones aunque el scraper esté caído
- El readiness endpoint refleja el estado real de DB

## Workload Separation: Read (API) vs Write (Worker)

### API (read path)

```
GET /api/licitaciones        → SELECT con filtros + cursor pagination
GET /api/licitaciones/:id    → SELECT by id o codigo_externo
GET /api/licitaciones/regions → SELECT DISTINCT
GET /api/installations       → SELECT con filters
PATCH /api/installations     → UPSERT (IDEMPOTENT — ON CONFLICT)
```

### Worker (write path)

```
runIngestCycle     → INSERT licitaciones + notification_events + notification_deliveries
runDispatchCycle   → UPDATE deliveries + send push
runReceiptCycle    → UPDATE delivery status (receipt processing)
runCleanupCycle    → DELETE → INSERT archive (licitaciones + deliveries)
runArchiveExportCycle → EXPORT to Parquet → UPLOAD to S3
```

### Worker Runtime isolation

```typescript
// worker-runtime.ts — cada ciclo con flag running independiente
let ingestRunning = false;
let dispatchRunning = false;
let receiptRunning = false;
let cleanupRunning = false;
let archiveExportRunning = false;

async function runWithLock(flag: "ingest" | "dispatch" | "receipt" | ...) {
  if (current) {
    workerLogger.warn("worker_already_running", { job: flag });
    return false; // No overlap
  }
  // set flag → true
}
```

Cada ciclo corre en su propio intervalo cron. No se bloquean entre sí:
- Ingest: cada 2 min (`WORKER_INTERVAL_MINUTES`)
- Dispatch: cada 1 min (`DISPATCH_INTERVAL_MINUTES`)
- Receipt: cada 1 min (`RECEIPT_INTERVAL_MINUTES`)
- Cleanup: 03:17 diario (`CLEANUP_CRON`)
- Archive export: 03:47 diario (`ARCHIVE_EXPORT_CRON`)

## Dependency Injection Pattern

Los ciclos del worker usan **factory functions** con `WorkerDependencies` para testabilidad:

```typescript
interface WorkerDependencies {
  query: typeof query;
  queryResult: typeof queryResult;
  pushProvider: PushProvider;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export function createRunIngestCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };
  return async function runIngestCycle(): Promise<WorkerResult> {
    // usar deps.query, deps.pushProvider, etc.
  };
}
```

**Regla**: Cada ciclo exporta tanto `createRunXCycle(overrides)` (para tests con mocks)
como `runXCycle` (singleton default para runtime).

## Consistent Error Responses

Toda respuesta de error sigue el mismo formato JSON:

```typescript
// Error
{ "error": "Mensaje descriptivo" }

// Success
{ "data": { ... } }
{ "data": [ ... ], "pageInfo": { ... } }
```

Códigos HTTP:
- 200 — Success
- 400 — Bad request (cursor inválido, parámetros inválidos)
- 404 — Not found
- 500 — Error interno (siempre loggeado)

## Seguridad

### Content Security Policy (CSP)

> CSP le dice al navegador qué recursos puede cargar y de dónde. Previene XSS.

```typescript
// En producción, agregar header CSP vía Express middleware:
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://api.example.com",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  next();
});
```

### Security Headers esenciales

```typescript
// Middleware de seguridad global
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");           // Prevenir clickjacking
  res.setHeader("X-Content-Type-Options", "nosniff");  // Prevenir MIME sniffing
  res.setHeader("X-XSS-Protection", "0");              // Desactivar legacy (obsoleto)
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
```

### Prevención de XSS en el servidor

- Validar y sanitizar TODOS los inputs de usuario (Zod en frontend + validación en backend)
- NO usar `eval()`, `new Function()`, o `setTimeout(string)` en Node.js
- Usar parámetros preparados (`$1`, `$2`) en todas las queries SQL (ya se hace en `db.ts`)
- NO devolver HTML generado dinámicamente desde el servidor (API REST pura)
- Mantener dependencias actualizadas (`npm audit` periódicamente)

### JWT

- El token JWT se firma con `JWT_SECRET` (variable de entorno)
- Expiración: 7 días (`expiresIn: "7d"`)
- Nunca almacenar en localStorage información sensible
- En producción, usar `JWT_SECRET` seguro (32+ chars, generado aleatoriamente)

## Referencias

- NotiChileC project: `.agents/skills/notichilec-project/SKILL.md`
- Worker architecture: `.agents/skills/notichilec-worker-architecture/SKILL.md`
- DB schema: `.agents/skills/notichilec-db/SKILL.md`
- API patterns: `.agents/skills/notichilec-api/SKILL.md`
- `server/src/app.ts` — middleware global + health checks
- `server/src/api-server.ts` — bootstrap API puro
- `server/src/server.ts` — bootstrap combinado (API + worker)
- `server/src/db.ts` — pool + query helpers
- `server/src/routes/*.ts` — handlers por recurso
