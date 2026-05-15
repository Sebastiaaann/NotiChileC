---
name: notichilec-push-retry
description: >
  Patrones de retry para registro y envío de push notifications en NotiChileC.
  Trigger: Modificar el registro de push tokens, el envío de notificaciones, o el worker de dispatch.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Modificar `api.ts` (mobile) o `_layout.tsx` donde se registra el push token
- Modificar el worker dispatch o receipt cycles
- Debuggear entregas de push notifications

---

## 1. Registro de Push Token (Mobile)

### Patrón actual

```typescript
// src/services/api.ts
async function registerTokenWithRetry(token: string, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fetch(`${API_URL}/api/installations`, {
        method: "PATCH",
        body: JSON.stringify({ pushToken: token }),
      });
      return;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
}
```

**Reglas**:
- Máximo 3 reintentos con exponential backoff (1s, 2s, 4s)
- Si falla después de 3 intentos, el error se captura pero NO se bloquea la app
- El `_layout.tsx` llama `registerTokenWithRetry()` al montar la app

---

## 2. Envío de Push (Worker)

### Patrón actual

El worker dispatch cycle usa:

1. **FOR UPDATE SKIP LOCKED** para seleccionar deliveries pendientes sin bloquear otros workers
2. **ON CONFLICT DO NOTHING** para evitar duplicados en `notification_deliveries`
3. **Exponential backoff** (cap 60min) para deliveries retryables

```sql
-- Worker query para deliveries retryables
UPDATE notification_deliveries
SET status = 'sent', sent_at = NOW()
WHERE id IN (
  SELECT id FROM notification_deliveries
  WHERE status IN ('pending', 'retryable')
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 100
);
```

### Estados de delivery

```
pending  →  sent  →  ok / failed / invalid
  ↑          ↓
  └── retryable ←──┘
```

### Exponential backoff

```typescript
const delayMinutes = Math.min(60, Math.pow(2, cappedAttempt - 1));
// attempt 1 → 1 min, attempt 2 → 2 min, attempt 3 → 4 min... cap 60 min
```

---

## 3. Receipt Processing (Worker)

El receipt cycle checkea confirmaciones de Expo Push y actualiza estados. Si un delivery sigue fallando después de todos los reintentos, pasa a `invalid` y se deja de intentar.

---

## Referencias

- `src/services/api.ts` — `registerTokenWithRetry()`
- `app/_layout.tsx` — registro de push token
- `server/src/push-provider.ts` — envío de push
- `server/src/worker-runtime.ts` — dispatch + receipt cycles
- Skill: `notichilec-worker-architecture` (detalle de locking y ciclos)
- Skill: `notichilec-api` (API patterns)
