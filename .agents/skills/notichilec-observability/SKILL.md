---
name: notichilec-observability
description: >
  Convenciones de logging, métricas y Sentry para el backend NotiChileC.
  Trigger: Modificar server, rutas, worker, o agregar nuevo código que requiera logging o monitoreo.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Agregar logging a una ruta nueva, ciclo del worker, o función crítica
- Modificar métricas existentes o agregar métricas nuevas
- Capturar errores con Sentry
- Debuggear comportamiento de producción

---

## 1. Logger (`src/observability/logger.ts`)

### Niveles

```typescript
apiLogger.info("http_request_completed", { method: "GET", status_code: 200 });
apiLogger.warn("worker_skipped", { reason: "already_running" });
apiLogger.error("api_unhandled_exception", { error, request_id });
```

| Nivel | Cuándo usarlo |
|-------|---------------|
| `info` | Eventos normales (request completado, ciclo ejecutado, usuario registrado) |
| `warn` | Comportamiento esperado pero anómalo (worker saltado, recurso no encontrado) |
| `error` | Fallos que requieren atención (excepción no manejada, fallo de DB) |

### Patrón de nomenclatura

```
<dominio>_<accion>
         ↓
api_unhandled_exception
worker_already_running
user_registered
auth_login_error
```

**Regla**: Siempre `snake_case`, sin mayúsculas. El dominio es la primera parte (`api`, `worker`, `auth`, `scraper`, `db`).

### Campos obligatorios

```typescript
// En rutas HTTP: siempre incluir request_id
apiLogger.info("http_request_completed", {
  request_id: req.requestId,  // ← obligatorio
  method: req.method,
  status_code: res.statusCode,
});

// En worker: job/cycle name
workerLogger.info("ingest_completed", {
  job: "ingest",
  licitaciones_inserted: 15,
  duration_ms: 1234,
});
```

---

## 2. Métricas Prometheus (`src/observability/metrics.ts`)

### Métricas existentes

| Nombre | Tipo | Descripción |
|--------|------|-------------|
| `http_requests_total` | Counter | Requests HTTP por método + ruta + status |
| `http_request_duration_ms` | Histogram | Duración de requests en ms |
| `db_pool_total` | Gauge | Conexiones totales del pool |
| `db_pool_idle` | Gauge | Conexiones idle |
| `db_pool_waiting` | Gauge | Conexiones esperando |
| `queue_pending` | Gauge | Deliveries pendientes |
| `queue_retryable` | Gauge | Deliveries retryables |
| `worker_runs_total` | Counter | Ejecuciones de worker por ciclo |

### Agregar métricas nuevas

Seguir el patrón existente:

```typescript
import { metrics } from "./metrics";

// Nuevo gauge
const myMetric = new metrics.Gauge({
  name: "my_metric_name",
  help: "Descripción de la métrica",
  labelNames: ["dimension1"], // opcional
});

// Update
myMetric.set(value);
myMetric.labels("value").set(1);
```

**Regla**: Nombres en `snake_case`, prefijo de dominio (`db_`, `http_`, `queue_`, `worker_`).

---

## 3. Sentry (`src/observability/sentry.ts`)

### Captura de errores

```typescript
import { captureException } from "./observability/sentry";

try {
  // código que puede fallar
} catch (error) {
  captureException(error, {
    requestId: req.requestId,
    method: req.method,
    route: req.path,
  });
}
```

### Cuándo capturar

- Errores HTTP 500 no manejados (ya capturados en `app.ts` error middleware)
- Fallos en ciclos del worker (cada ciclo tiene su propio try/catch)
- Fallos en scraping
- NO capturar errores HTTP 4xx (son del cliente)

---

## Referencias

- `server/src/observability/` — implementaciones de logger, metrics, sentry
- `server/src/app.ts` — middleware error handler + logging
- `server/src/worker-runtime.ts` — logging de ciclos
- Skill: `notichilec-backend-architecture` (server layers)
- Skill: `notichilec-api` (API patterns)
