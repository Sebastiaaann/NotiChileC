# TypeScript Patterns — NotiChileC

## Propósito

Guía de patrones y reglas de TypeScript para el desarrollo en NotiChileC. Complementa el skill `notichilec-typescript` con ejemplos concretos del proyecto y justificación técnica.

Está dirigida a **desarrolladores** que necesitan entender el *por qué* detrás de cada regla. Las reglas ejecutables para agentes están en `.agents/skills/notichilec-typescript/SKILL.md`.

---

## 1. `unknown` sobre `any`

### Problema

`any` desactiva completamente el sistema de tipos. Cualquier error que TypeScript podría haber capturado en compile-time se convierte en un runtime error. En un proyecto con datos externos (API de ChileCompra, push tokens), esto es particularmente peligroso.

### Solución

Usar `unknown` para valores cuyo tipo no se conoce de antemano. `unknown` fuerza al desarrollador a hacer type narrowing (con `typeof`, `instanceof`, o type guards) antes de usar el valor.

### En el proyecto

```ts
// API responses pueden tener formas impredecibles
// ✅ con unknown:
async function fetchLicitacion(id: string): Promise<unknown> {
  const res = await fetch(`/api/licitaciones/${id}`);
  return res.json(); // no sabemos la forma exacta hasta runtime
}
// El caller DEBE hacer narrowing:
const data = await fetchLicitacion('123');
if (isLicitacion(data)) {
  console.log(data.nombre); // ✅ safe
}
```

### Justificación técnica

TypeScript es un sistema de tipos **estructural**, no nominal. Usar `any` rompe ese contrato. `unknown` es el type-safe top type: cualquier cosa es asignable a `unknown`, pero `unknown` no es asignable a nada sin narrowing.

---

## 2. `as const` sobre `enum`

### Problema

Los `enum` nativos de TypeScript tienen comportamientos sorprendentes:
- Los enums numéricos tienen reverse mapping automático (generan código extra en el bundle)
- Los enums const (`const enum`) no existen en runtime
- Los enums son valores y tipos a la vez, lo que puede causar confusión
- No son tree-shakeables de forma confiable

### Solución

Objetos `as const` + `z.enum()` para validación en runtime:

```ts
// En el proyecto:
export const ESTADOS_LICITACION = {
  PUBLICADA: 'Publicada',
  ADJUDICADA: 'Adjudicada',
  DESIERTA: 'Desierta',
} as const;

export type EstadoLicitacion = (typeof ESTADOS_LICITACION)[keyof typeof ESTADOS_LICITACION];

// Schema Zod que deriva los valores automáticamente
export const estadoLicitacionSchema = z.enum([
  ESTADOS_LICITACION.PUBLICADA,
  ESTADOS_LICITACION.ADJUDICADA,
  ESTADOS_LICITACION.DESIERTA,
] as const);

// Uso en schema mayor:
export const licitacionSchema = z.object({
  estado: estadoLicitacionSchema,
});
```

### Cuándo usar `enum` (excepción)

Solo cuando se necesita **reverse mapping**: convertir un valor numérico a string. Ejemplo: códigos HTTP, códigos de error de Expo Push, flags de base de datos.

```ts
// reverse mapping necesario para logging
enum PushErrorCode {
  DeviceNotRegistered = 'ERR_DEVICE_NOT_REGISTERED',
  MessageTooBig = 'ERR_MESSAGE_TOO_BIG',
}
// PushErrorCode.DeviceNotRegistered → 'ERR_DEVICE_NOT_REGISTERED'
// PushErrorCode['ERR_DEVICE_NOT_REGISTERED'] → 'DeviceNotRegistered' ← reverse mapping
```

---

## 3. Interfaces para APIs, Types para uniones

### Problema

Sin una convención clara, los desarrolladores mezclan `interface` y `type` sin criterio. Ambos son similares, pero tienen diferencias importantes.

### Regla del proyecto

| Situación | Usar | Motivo |
|-----------|------|--------|
| Contrato público (repositorio, hook, prop de componente compartido) | `interface` | Las interfaces son extensibles, dan mejores errores en TypeScript, y son el estándar para APIs públicas |
| Unión (`A \| B`) | `type` | `interface` no puede representar uniones |
| Intersección (`A & B`) | `type` | `interface extends` tiene limitaciones con tipos complejos |
| Tipo derivado (Pick, Omit, ReturnType) | `type` | Los utility types devuelven `type`, no `interface` |
| Tupla | `type` | `interface` no soporta tuplas |

### En el proyecto

```ts
// ✅ interface: contrato público
interface ILicitacionesRepo {
  getAll(filtros: FiltroFeed): Promise<Licitacion[]>;
}

// ✅ type: unión
type SortOption = 'fecha' | 'monto' | 'relevancia';

// ✅ type: derivado
type LicitacionCard = Pick<Licitacion, 'id' | 'nombre' | 'monto_label'>;
```

---

## 4. Utility types

### Problema

Escribir tipos manualmente para casos que TypeScript ya resuelve con utility types. Por ejemplo, crear una interface `UpdateLicitacion` con todos los campos opcionales en vez de usar `Partial<Licitacion>`.

### Utility types disponibles

| Utility | Para qué | Ejemplo en el proyecto |
|---------|----------|----------------------|
| `Partial<T>` | Updates parciales (PATCH) | `Partial<Licitacion>` para actualizar solo algunos campos |
| `Required<T>` | Versión no-opcional | `Required<FiltroFeed>` para forzar todos los filtros |
| `Readonly<T>` | Inmutabilidad | `Readonly<Licitacion[]>` para datos que no deben mutarse |
| `Pick<T, K>` | Subset de propiedades | `Pick<Licitacion, 'id' \| 'nombre'>` para cards |
| `Omit<T, K>` | Excluir propiedades | `Omit<Licitacion, 'created_at'>` para crear |
| `Record<K, V>` | Diccionarios | `Record<Categoria, number>` para conteos |
| `ReturnType<F>` | Tipo de retorno de función | `ReturnType<typeof useFeed>` para inferir tipo del hook |
| `NonNullable<T>` | Remover null/undefined | `NonNullable<Licitacion \| null>` |

### Anti-patrón

```ts
// ❌ MAL: repetir campos manualmente
interface LicitacionCard {
  id: string;
  nombre: string;
  monto_label?: string;
}

// ✅ BIEN: derivar del tipo original
type LicitacionCard = Pick<Licitacion, 'id' | 'nombre' | 'monto_label'>;
```

---

## 5. Genéricos en repositorios

### Problema

Cada repositorio implementa los mismos métodos (`getAll`, `getById`, `create`, `update`, `delete`) con tipos diferentes. Sin genéricos, hay que repetir las interfaces.

### Solución

```ts
// En core/repositories/:
interface IRepositorio<T extends { id: string }> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

// Uso en Licitaciones:
interface ILicitacionesRepo extends IRepositorio<Licitacion> {
  // métodos específicos además de los genéricos
  getByCategoria(categoria: Categoria): Promise<Licitacion[]>;
}
```

### En el proyecto

Todos los repositorios en `core/repositories/` deben seguir este patrón. Ver ejemplos en `infrastructure/api/` para implementaciones concretas.

---

## 6. Type predicates post-filter

### Problema

TypeScript no infiere narrowing después de `.filter()`. El tipo del array filtrado sigue incluyendo los valores que el filter elimina.

```ts
// ❌ El tipo NO se reduce:
const resultados = items.filter(item => item !== null);
// resultados → (Licitacion | null)[]  ← incorrecto
```

### Solución

```ts
// ✅ Type predicate explicito:
const resultados = items.filter((item): item is Licitacion => item !== null);
// resultados → Licitacion[]  ← correcto
```

### En el proyecto

```ts
// Ejemplo real: filtrar nulls de una respuesta de API
type ApiResponse<T> = { data: T | null }[];

const responses: ApiResponse<Licitacion>[] = [/* ... */];
const validos = responses
  .map(r => r.data)
  .filter((item): item is Licitacion => item !== null);
// validos: Licitacion[]
```

---

## 7. Zod + `z.infer` como única fuente de verdad

### Problema

Cuando los tipos de datos de entrada se definen manualmente y los schemas de validación se definen por separado, inevitablemente divergen. El schema cambia, el tipo no, y el error aparece en runtime.

### Solución

El schema Zod ES la definición del tipo. El tipo se infiere automáticamente:

```ts
// En el proyecto:
const licitacionApiSchema = z.object({
  CodigoExterno: z.string(),
  Nombre: z.string(),
  MontoEstimado: z.number().positive().optional(),
  FechaPublicacion: z.string().datetime(),
  Organismo: z.string().optional(),
  Estado: z.enum(['Publicada', 'Adjudicada', 'Desierta']),
  Region: z.string().optional(),
});

// Tipo inferido automáticamente:
type LicitacionAPI = z.infer<typeof licitacionApiSchema>;

// Schema para el frontend (adaptado):
export const licitacionSchema = licitacionApiSchema.transform(raw => ({
  id: raw.CodigoExterno,
  nombre: raw.Nombre,
  monto_estimado: raw.MontoEstimado,
  fecha_publicacion: new Date(raw.FechaPublicacion),
  organismo: raw.Organismo,
  estado: raw.Estado,
  region: raw.Region,
}));

export type Licitacion = z.infer<typeof licitacionSchema>;
```

### Dónde aplica

- **API responses**: Todo endpoint que devuelve JSON debe tener su schema Zod
- **Formularios**: React Hook Form usa `z.infer` para el tipo del formulario
- **DTOs de creación/actualización**: Schemas de validación = definición de tipo

### Anti-patrón

```ts
// ❌ MAL: tipo manual + schema separado
interface LicitacionInput {
  nombre: string;
  monto?: number;
}
const licitacionInputSchema = z.object({
  nombre: z.string().min(1),
  monto: z.number().positive().optional(),
});
// Si el schema cambia, el tipo NO se actualiza
```

---

## 8. Strict mode en tsconfig

### Por qué `strict: true`

`strict: true` habilita un conjunto de checks que previenen bugs comunes:

| Check | Qué previene |
|-------|-------------|
| `noImplicitAny` | Parámetros sin tipo explícito |
| `strictNullChecks` | Acceso a null/undefined sin verificar |
| `strictFunctionTypes` | Asignaciones incorrectas de funciones |
| `strictBindCallApply` | Uso incorrecto de bind/call/apply |
| `strictPropertyInitialization` | Propiedades de clase sin inicializar |
| `noUncheckedIndexedAccess` | Acceso a arrays sin verificar índice |

### En el proyecto

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### Ejemplo de `noUncheckedIndexedAccess`

```ts
const items: string[] = ['a', 'b', 'c'];
const first = items[0];
// Sin la flag: first → string
// Con la flag: first → string | undefined  ← obliga a checkear
if (first !== undefined) {
  console.log(first.toUpperCase()); // ✅ safe
}
```

---

## Conexiones

- Skill de reglas para agentes: `.agents/skills/notichilec-typescript/SKILL.md`
- Frontend web: `.agents/skills/notichilec-frontend/SKILL.md`
- Backend API: `.agents/skills/notichilec-api/SKILL.md`
- Diseño frontend: `docs/plans/2026-05-15-frontend-architecture-design.md`
