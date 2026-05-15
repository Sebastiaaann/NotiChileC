---
name: notichilec-api
description: >
  Backend API de NotiChileC (Express + PostgreSQL + Push Notifications).
  Trigger: Cuando se trabaja con el servidor, endpoints, worker, push, o DB.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
---

## When to Use

- Modificar endpoints de la API
- Cambiar la lógica del worker o cron
- Agregar/quitar push notifications
- Modificar el schema de DB
- Deploy del servidor

## Critical Patterns

### Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **Framework**: Express.js
- **DB**: PostgreSQL (pg driver)
- **Push**: Expo Push Notifications (expo-server-sdk)
- **Cron**: node-cron

### Estructura

```
server/src/
├── server.ts              # Bootstrap combinado (API + worker)
├── api-server.ts          # Bootstrap API solo
├── app.ts                 # Express app (middleware, routes, error handler)
├── worker.ts              # 5 ciclos del worker
├── worker-runtime.ts      # Scheduler cron + run-with-lock
├── scraper.ts             # Scraper de ChileCompra
├── chilecompra.ts         # Cliente API ChileCompra
├── push.ts                # Expo Push provider
├── push-provider.ts       # Interfaces PushProvider
├── db.ts                  # PostgreSQL pool
├── notification-targeting.ts  # Matching preferencias
├── feed-sort.ts           # Modos de ordenamiento
├── archive-jobs.ts        # Exportación Parquet + S3
├── archive-storage.ts     # S3 client
├── observability/         # Logger, Sentry, métricas
├── types/                 # Tipos compartidos
└── routes/
    ├── devices.ts         # POST /api/devices/register
    ├── installations.ts   # POST /api/installations/sync
    ├── licitaciones.ts    # GET /api/licitaciones
    └── rubros.ts          # GET /api/rubros
```

### DB Schema

```sql
-- Licitaciones
CREATE TABLE licitaciones (
  id TEXT PRIMARY KEY,
  codigo_externo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  organismo_nombre TEXT,
  tipo TEXT,
  monto_estimado NUMERIC(14,0),
  monto_label TEXT,           -- Texto descriptivo cuando monto no es numérico
  moneda TEXT DEFAULT 'CLP',
  fecha_publicacion TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  estado TEXT DEFAULT 'Publicada',
  url TEXT,
  region TEXT,
  categoria TEXT DEFAULT 'General',
  notificada BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tokens de dispositivos
CREATE TABLE device_tokens (
  id SERIAL PRIMARY KEY,
  expo_push_token TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Runs del worker
CREATE TABLE worker_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  licitaciones_found INT DEFAULT 0,
  licitaciones_new INT DEFAULT 0,
  notifications_sent INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Push Notifications

Usar `sendPushToAll()` de `push.ts`. Siempre verificar `sent > 0` antes de marcar `notificada = TRUE`.

### Error Handling

- `finishRun()` SIEMPRE en `finally` block
- Guardar `error_message` en DB
- Contador `consecutiveFailures` para alertas

### Variables de entorno

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
CHILECOMPRA_TICKET=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
PORT=3000
WORKER_INTERVAL_MINUTES=2
```

## Commands

```bash
# Iniciar servidor
cd server && npm run dev

# Test endpoint
curl http://localhost:3000/api/health

# Ver licitaciones
curl http://localhost:3000/api/licitaciones?limit=5

# Test push
cd server && npx tsx scripts/test-push.ts
```

## Archivos clave

- `server/src/server.ts` — Setup principal
- `server/src/worker.ts` — Lógica del worker
- `server/src/routes/licitaciones.ts` — Endpoint de licitaciones
- `server/.env` — Variables de entorno (NO commitear)
- `server/bootstrap.sql` — Schema inicial de DB

## Referencias

- TypeScript patterns: `.agents/skills/notichilec-typescript/SKILL.md` + `docs/plans/typescript-patterns.md`
- NotiChileC project: `.agents/skills/notichilec-project/SKILL.md`
- DB schema: `.agents/skills/notichilec-db/SKILL.md`
- Backend architecture (server layers, idempotency, graceful degradation): `.agents/skills/notichilec-backend-architecture/SKILL.md`
- Worker architecture (5 cycles, FOR UPDATE SKIP LOCKED, saga choreography): `.agents/skills/notichilec-worker-architecture/SKILL.md`
