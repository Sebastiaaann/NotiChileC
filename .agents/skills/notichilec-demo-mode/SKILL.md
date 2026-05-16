---
name: notichilec-demo-mode
description: >
  Sistema de modo demo para NotiChileC (backtend + frontend).
  Trigger: Trabajar con datos demo, app-env, o el fallback de demo.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Inicializar la app en modo demo (sin backend real)
- Agregar nuevas entidades/features que necesiten datos demo
- Modificar `appEnv.ts`, `demo-data.ts`, o rutas que usen `withDemoFallback`

---

## Arquitectura del Modo Demo

```
app-env.ts (isDemoApp)
    │
    ├── demo-data.ts — In-memory data store con datos falsos
    │
    └── withDemoFallback() → middleware que intercepta requests
          ├── si demo: responde con demo-data
          └── si no demo: pasa al handler real
```

### Cómo funciona

El modo demo se activa vía variable de entorno o flag de build. Cuando está activo:

1. **Backend**: `withDemoFallback` intercepta requests y responde con datos mock (sin DB, sin scraper)
2. **Frontend**: la app funciona con datos de mock sin necesidad de backend
3. **Worker**: no se ejecuta en modo demo

### Cómo detectar demo

```typescript
import { isDemoApp } from "@/infrastructure/api/app-env";

if (isDemoApp()) {
  // comportamiento específico de demo
}
```

### Reglas

- **NUNCA** asumir que `isDemoApp()` es false — siempre checkear
- **NO** hardcodear datos demo en rutas/productivas — usar `demo-data.ts`
- Al agregar una nueva feature, verificar si necesita datos demo. Si sí, agregarlos a `demo-data.ts`
- El modo demo debe funcionar sin conexión a DB

---

## Referencias

- `src/infrastructure/api/app-env.ts` — `isDemoApp()`
- `src/infrastructure/api/demo-data.ts` — datos mock
- `server/src/demo/` — scripts demo seed/reset/smoke
- Skill: `notichilec-api` (API patterns)
