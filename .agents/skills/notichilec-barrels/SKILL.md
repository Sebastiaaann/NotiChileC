---
name: notichilec-barrels
description: >
  Convenciones de barrel exports para FrontNotiChileC y NotiChileC.
  Trigger: Agregar/quitar módulos, refactorizar imports, o crear carpetas con múltiples archivos que se importan juntos.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Crear una carpeta nueva con múltiples módulos
- Notar que 3+ imports de una misma carpeta se repiten en varios archivos
- Refactorizar imports largos o redundantes
- Decidir si una carpeta merece barrel o no
- Agregar o eliminar módulos dentro de una carpeta que ya tiene barrel

## Regla Fundamental

> **Barrel sí, pero con criterio. No todo es barrel.**

Un barrel (`index.ts`) solo cuando los módulos de una carpeta **siempre se usan juntos**. Si se usan por separado, el barrel es deuda técnica.

## Cuándo crear un barrel

```ts
// ✅ CASO IDEAL: barrel sí
// observability/logger.ts, observability/sentry.ts, observability/metrics.ts
// Se importan SIEMPRE juntos en 5+ archivos

// observability/index.ts
export { apiLogger } from './logger';
export { captureException } from './sentry';
export { renderMetrics } from './metrics';

// Import result:
import { apiLogger, captureException, renderMetrics } from './observability';
```

```ts
// ❌ CASO PROBLEMÁTICO: NO hacer barrel
// services/ tiene 11 archivos que se usan en combinaciones dispares
// Un barrel forzaría a incluir módulos no usados en el bundle
// Mejor import directo o con path alias:

import { getFeed } from '@/services/api';
import { sortLicitaciones } from '@/services/feed-sort';
```

## Reglas estrictas

### 1. NUNCA usar `export *`

```ts
// ❌ MAL: export * mata tree-shaking
export * from './Button';
export * from './Alert';
export * from './Card';

// ✅ BIEN: named re-exports explícitos
export { Button } from './Button';
export { Alert } from './Alert';
export { Card } from './Card';
```

**Motivo**: `export *` re-exporta TODO sin discriminar — el bundler no puede saber qué se usa realmente. Con named exports (`export { X }`), el bundler sabe exactamente qué se importa y puede tree-shake el resto.

Esto es **crítico** en React Native (Metro bundler) que es menos agresivo con tree-shaking que webpack/Vite. En el frontend web (Vite), aplicar la misma regla por consistencia.

### 2. Un barrel NO debe cruzar capas

```ts
// ❌ MAL: barrel que mezcla features
// features/index.ts
export * from './feed';
export * from './auth';
export * from './settings';

// ✅ BIEN: cada feature tiene su propio barrel, NO hay barrel global
// features/feed/index.ts → exporta FeedContainer
// features/auth/index.ts → exporta AuthContainer
```

Las features son lazy-loadables. Un barrel global las cargaría TODAS.

### 3. Barrel de dominio vs barrel de subcarpeta

Para features con varios archivos, tener barrel SOLO en la subcarpeta que corresponda:

```ts
// features/auth/components/index.ts → OK: agrupa componentes visuales
export { LoginForm } from './LoginForm';
export { RegisterForm } from './RegisterForm';

// features/auth/index.ts → OK: barrel del feature exporta Container
export { AuthContainer } from './AuthContainer';

// features/auth/services/index.ts → NO: un solo archivo no necesita barrel
```

### 4. Mantener barrels al día

Cada vez que agregués o eliminés un módulo de una carpeta con barrel:

```ts
// Después de eliminar Alert.tsx...
// ❌ MAL: barrel queda con referencia muerta
export { Button } from './Button';
export { Alert } from './Alert'; // ← esto rompe en runtime

// ✅ BIEN: limpiar el barrel
export { Button } from './Button';
```

### 5. Barrel + path alias

Usar path aliases (`@/`) combinado con barrels para máxima claridad:

```ts
// Con barrel + path alias:
import { apiLogger, captureException } from '@/observability';

// Sin barrel, con path alias (para casos que NO son barrel):
import { getFeed } from '@/services/api';
```

## Árbol de decisión

```
¿Los módulos de esta carpeta se importan SIEMPRE juntos (3+ ocurrencias)?
  ├── Sí → ¿Son más de 8 módulos?
  │   ├── Sí → Partir en sub-barrels lógicos
  │   └── No → Crear barrel con named re-exports
  └── No → NO crear barrel. Usar import directo con path alias.
```

## Candidatos barrel en FrontNotiChileC

| Carpeta | ¿Barrel? | Motivo |
|---------|----------|--------|
| `src/core/entities/` | ✅ | Entidades se importan juntas |
| `src/core/repositories/` | ✅ | Interfaces se usan juntas |
| `src/shared/ui/` | ❌ No | shadcn components se usan individualmente |
| `src/shared/lib/` | ✅ | cn, format, constants van juntos |
| `src/infrastructure/api/adapters/` | ✅ | Adapters se usan juntos en el repo |
| `features/X/components/` | ✅ | Componentes de una feature se usan juntos |
| `features/X/hooks/` | ✅ | Hooks de feature se usan juntos |

## Anti-Patterns

### ❌ Barrel global en `src/index.ts`
Impide lazy loading, fuerza a cargar TODO en el bundle inicial.

### ❌ Barrel que re-exporta tipos únicamente
```ts
// Evitable: los tipos se usan en archivos individuales
export { Licitacion } from './entities/Licitacion'; // ← si solo se usa en 1 lugar, no hace falta barrel
```

### ❌ Barrel anidado (barrel que re-exporta otro barrel)
```ts
// features/auth/index.ts
export * from './components'; // ← NO: está re-exportando otro barrel
// Mejor: importar directo de components si se necesita
```

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Doc barrels: `docs/plans/barrel-exports-convention.md`
- Skill: `notichilec-frontend` (arquitectura general)
- Skill: `notichilec-component-design` (Component Design)
