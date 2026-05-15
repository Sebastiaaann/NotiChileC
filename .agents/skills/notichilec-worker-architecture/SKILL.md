---
name: notichilec-worker-architecture
description: >
  Arquitectura del worker asincrónico de NotiChileC. 5 ciclos run-with-lock,
  FOR UPDATE SKIP LOCKED para concurrencia, saga coreografía vía DB,
  at-least-once delivery con dedup, exponential backoff, eventual consistency.
  Trigger: Modificar worker, ciclos, push delivery, o concurrencia.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Modificar `server/src/worker.ts` o cualquiera de los 5 ciclos
- Agregar un nuevo ciclo al worker
- Debuggear entregas de push atascadas o duplicadas
- Cambiar lógica de locking, backoff, o retry
- Modificar `worker-runtime.ts` (scheduler, run-with-lock)
- Cambiar `push.ts` o `push-provider.ts`

## 5 Run-With-Lock Cycles

El worker ejecuta 5 ciclos independientes, cada uno con su propia frecuencia y flag de ejecución:

```
worker-runtime.ts
├── ingest: cada 2 min (WORKER_INTERVAL_MINUTES)
├── dispatch: cada 1 min (DISPATCH_INTERVAL_MINUTES)
├── receipt: cada 1 min (RECEIPT_INTERVAL_MINUTES)
├── cleanup: 03:17 diario (CLEANUP_CRON)
└── archive-export: 03:47 diario (ARCHIVE_EXPORT_CRON)
```

Cada ciclo tiene un `*Running` flag booleano que previene superposición
(en memoria, no en DB — para eso está `FOR UPDATE SKIP LOCKED`):

```typescript
async function runWithLock(flag: "ingest" | "dispatch" | "receipt" | "cleanup" | "archive_export") {
  if (current) {
    workerLogger.warn("worker_already_running", { job: flag });
    return false;
  }
  // set flag → true
}
```

### Cycle 1: Ingest (runIngestCycle)

Obtiene licitaciones nuevas de ChileCompra (scraper + API) y las persiste:

1. `scrapeLicitaciones(20)` — scraper web (falla graceful, no bloquea)
2. `fetchLicitacionesSummary(today)` + `fetchLicitacionDetail()` — API ChileCompra
3. `loadExistingCodigos()` — consulta `licitacion_registry` para filtrar existentes
4. `upsertPendingRecord()` — mergea datos de scraper + API prefiriendo el más completo
5. `INSERT INTO licitacion_registry ... ON CONFLICT DO NOTHING` — reclama codigos nuevos
6. `INSERT INTO licitaciones ...` + `ON CONFLICT` — persiste solo si registry claimó éxito
7. `createNotificationEvent()` — `INSERT INTO notification_events ... ON CONFLICT DO UPDATE`
8. `loadCandidateInstallations()` — JOIN `device_installations` + `notification_preferences`
9. `createNotificationDeliveries()` — `INSERT INTO notification_deliveries ... ON CONFLICT DO NOTHING`

### Cycle 2: Dispatch (runDispatchCycle)

Envía push notifications a través de Expo:

1. `lockDispatchDeliveries()` — SELECT con **FOR UPDATE SKIP LOCKED** (ver abajo)
2. Para cada delivery:
   - Validar instalación (`isInstallationAllowed()`)
   - Validar preferencias (`matchesNotificationPreferences()`)
   - Enviar push (`pushProvider.send([buildPushInput(delivery)])`)
   - Actualizar outcome (`updateDispatchOutcome()`)
   - Marcar `licitaciones.notificada = TRUE`
3. Resultados: sent, retryable, failed, invalidated

### Cycle 3: Receipt (runReceiptCycle)

Procesa receipts de Expo para confirmar entrega:

1. `lockReceiptDeliveries()` — SELECT con FOR UPDATE SKIP LOCKED para deliveries en estado 'sent'
2. `pushProvider.fetchReceipts(ticketIds)` — consulta a Expo API
3. `applyReceiptOutcome()` — actualiza delivery status
4. Si `invalid`: invalida la instalación (`invalidateInstallation()`)

### Cycle 4: Cleanup (runCleanupCycle)

Archiwa datos viejos:

1. `archiveOldLicitaciones(hotMonths)` — mueve licitaciones > 12 meses a `archive.licitaciones`
2. `archiveOldDeliveries(retentionDays)` — mueve deliveries completados > 90 días a `archive.notification_deliveries`

### Cycle 5: Archive Export (runArchiveExportCycle)

Exporta datos archivados a Parquet y los sube a S3-compatible storage:

1. `runArchiveExportJob()` — selecciona candidatos de `archive_exports`
2. Exporta a formato Parquet con `parquetjs-lite`
3. Sube a S3 (configurable via `ARCHIVE_BUCKET`, `ARCHIVE_REGION`, `ARCHIVE_ENDPOINT`)
4. Verifica checksum post-subida
5. Marca `drop_eligible_at` para limpieza futura

## FOR UPDATE SKIP LOCKED

Usamos `FOR UPDATE SKIP LOCKED` para **concurrencia entre workers** (múltiples instancias).
Cada delivery solo es procesado por un worker a la vez:

```sql
-- worker.ts — lockDispatchDeliveries()
WITH due AS (
  SELECT nd.id
  FROM notification_deliveries nd
  WHERE nd.status IN ('pending', 'retryable')
    AND nd.completed_at IS NULL
    AND COALESCE(nd.next_attempt_at, nd.created_at) <= NOW()
    AND nd.locked_at IS NULL
  ORDER BY nd.created_at ASC, nd.id ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED    -- <-- salta filas lockeadas por otros workers
),
locked AS (
  UPDATE notification_deliveries nd
  SET locked_at = NOW(),
      locked_by = $2,
      updated_at = NOW()
  FROM due
  WHERE nd.id = due.id
  RETURNING nd.*
)
SELECT ... FROM locked
JOIN device_installations di ON di.installation_id = locked.installation_id
JOIN notification_events ne ON ne.id = locked.notification_event_id
JOIN licitaciones l ON l.id = ne.licitacion_id
```

**Patrón SELECT → UPDATE con FOR UPDATE SKIP LOCKED:**

1. `WITH due AS (SELECT ... FOR UPDATE SKIP LOCKED)` — selecciona filas disponibles
2. `locked AS (UPDATE ... SET locked_at = NOW() FROM due)` — marca como "en proceso"
3. `RETURNING` — devuelve datos completos para procesar

Registro worker en cada lock:
```typescript
workerId = `dispatch:${process.pid}:${Date.now()}`
```

SKIP LOCKED se usa también en `lockReceiptDeliveries()` para deliveries 'sent' pendientes de receipt.

## Saga Choreography via DB Table State

No usamos orquestador central ni colas externas. La coreografía se maneja mediante
estados en tablas PostgreSQL:

```
┌────────────────────────────────────────────────────────────┐
│ Saga: Nueva Licitación → Notificación → Entrega           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Ingest descubre licitación                             │
│     └→ INSERT INTO licitacion_registry (codigo_externo)    │
│     └→ INSERT INTO licitaciones                            │
│     └→ INSERT INTO notification_events (type, licitacion)  │
│     └→ INSERT INTO notification_deliveries (event, inst)   │
│                                                            │
│  2. Dispatch toma deliveries pendientes                    │
│     └→ FOR UPDATE SKIP LOCKED → UPDATE locked_at          │
│     └→ Envía push → UPDATE status (sent/retryable/failed) │
│     └→ UPDATE licitaciones SET notificada = TRUE           │
│                                                            │
│  3. Receipt procesa confirmaciones                         │
│     └→ FOR UPDATE SKIP LOCKED (status = 'sent')           │
│     └→ fetchReceipts() → UPDATE status (ok/retry/fail)    │
│     └→ Si invalid → UPDATE device_installations.active=f  │
│                                                            │
│  4. Dispatch retry (próximo ciclo)                         │
│     └→ WHERE status IN ('pending', 'retryable')           │
│     └→ next_attempt_at <= NOW()                            │
│     └→ locked_at IS NULL                                   │
│                                                            │
│  5. Cleanup archiva periódicamente                         │
│     └→ Mueve registros viejos a schema archive             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Reglas de coreografía:**
- Cada ciclo lee estado DB y actúa en consecuencia
- No hay mensajería ni eventos entre ciclos (todo pasa por DB)
- Cada delivery tiene estados: `pending → sent/retryable → ok/failed/invalid`
- `next_attempt_at` controla cuándo reintentar
- `locked_at` + `locked_by` evita procesamiento duplicado entre workers

## At-Least-Once Delivery with Dedup

Notificaciones se entregan **al menos una vez** con deduplicación vía `ON CONFLICT`:

```sql
-- worker.ts — buildDeliveryInsertValues()
INSERT INTO notification_deliveries (
  notification_event_id, installation_id, status, provider, ...
) VALUES (...)
ON CONFLICT (notification_event_id, installation_id) DO NOTHING
```

Esto significa:
- Si el worker falla después de crear deliveries, el próximo ciclo los retomará
- Si el worker crea deliveries y crashea antes de enviar, el dispatch los tomará
- `ON CONFLICT DO NOTHING` garantiza que no se dupliquen deliveries para el mismo par (evento, instalación)
- La unicidad está garantizada por `UNIQUE (notification_event_id, installation_id)` en la tabla

## Exponential Backoff (Capped)

Los reintentos de push usan backoff exponencial con **capped a 60 minutos**:

```typescript
// worker.ts
function buildExponentialBackoff(attemptCount: number): string {
  const cappedAttempt = Math.min(Math.max(attemptCount, 1), 6);
  const delayMinutes = Math.min(60, Math.pow(2, cappedAttempt - 1));
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}
```

| Attempt | Delay | Capped |
|---------|-------|--------|
| 1 | 1 min | 1 min |
| 2 | 2 min | 2 min |
| 3 | 4 min | 4 min |
| 4 | 8 min | 8 min |
| 5 | 16 min | 16 min |
| 6+ | 32+ min | 60 min (cap) |

```typescript
// worker.ts — updateDispatchOutcome()
next_attempt_at = outcome.status === "retryable"
  ? buildExponentialBackoff(delivery.attempt_count + 1)
  : null
```

Este `next_attempt_at` se escribe en la delivery y el dispatch loop lo respeta:
```sql
WHERE COALESCE(nd.next_attempt_at, nd.created_at) <= NOW()
```

## Eventual Consistency: Deliveries Table

La tabla `notification_deliveries` es la fuente de verdad para el estado de cada entrega:

| Columna | Propósito |
|---------|-----------|
| `status` | pending → sent/retryable → ok/failed/invalid |
| `attempt_count` | Número de intentos |
| `next_attempt_at` | Cuándo reintentar (backoff) |
| `locked_at` / `locked_by` | Lock de worker (FOR UPDATE SKIP LOCKED) |
| `completed_at` | Cuándo se completó (NULL si pendiente) |
| `last_error_code` / `last_error_message` | Último error |
| `provider_ticket_id` / `provider_receipt_id` | Tracking de Expo |

**Estados posibles:**
```
pending ──→ sent ──→ ok (via receipt, no-op)
pending ──→ retryable ──→ sent ──→ ok
pending ──→ retryable ──→ retryable ──→ ... → failed (tras 60 min cap)
pending ──→ failed (instalación no válida)
pending ──→ invalid (device not registered)
```

El delivery se considera "eventualmente consistente" porque:
- Los receipts se procesan en un ciclo separado (minutos después del dispatch)
- Los reintentos ocurren en ciclos futuros (backoff)
- `licitaciones.notificada` se actualiza en dispatch (no espera receipt)
- Si un receipt falla, no se revierte `notificada` — la licitación ya fue notificada

## Worker Runtime Tracking

Cada ejecución de ciclo se registra en `worker_runs`:

```sql
INSERT INTO worker_runs (started_at, worker_name) VALUES ($1, $2) RETURNING id

UPDATE worker_runs SET
  finished_at = NOW(),
  licitaciones_found = $2,
  licitaciones_new = $3,
  notifications_sent = $4,
  ...
  error_message = $13
WHERE id = $14
```

`createTrackedRunner()` envuelve cada ciclo con tracking automático:
```typescript
function createTrackedRunner(workerName, runnerFactory, overrides) {
  return async () => {
    runId = await startRun(deps, workerName);
    try {
      result = await runner();
      observeWorkerRun(workerName, "success", duration, result);
    } catch (error) {
      observeWorkerRun(workerName, "error", duration, result);
    } finally {
      await finishRun(deps, workerName, runId, result);
    }
  };
}
```

## Referencias

- Backend architecture: `.agents/skills/notichilec-backend-architecture/SKILL.md`
- DB schema: `.agents/skills/notichilec-db/SKILL.md`
- Project conventions: `.agents/skills/notichilec-project/SKILL.md`
- API patterns: `.agents/skills/notichilec-api/SKILL.md`
- `server/src/worker.ts` — todos los ciclos
- `server/src/worker-runtime.ts` — scheduler + run-with-lock
- `server/src/push.ts` — Expo push provider (ExpoPushProvider)
- `server/src/push-provider.ts` — interfaces PushProvider, PushNotificationInput, etc.
- `server/src/notification-targeting.ts` — matching preferences
- `server/bootstrap.sql` — schema de tablas de saga
