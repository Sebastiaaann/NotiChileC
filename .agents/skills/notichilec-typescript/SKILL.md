---
name: notichilec-typescript
description: >
  Patrones y reglas de TypeScript para NotiChileC (frontend web + backend Express).
  Trigger: Escribir o revisar tipos, interfaces, genéricos, Zod schemas, o config de tsconfig.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Escribir interfaces, types, o decoradores de tipo
- Definir schemas de Zod para datos de entrada (API responses, formularios)
- Trabajar con genéricos en repositorios o hooks
- Configurar `tsconfig.json` o revisar opciones de compilación
- Revisar código existente por malas prácticas de tipado (`any`, enums innecesarios, tipos duplicados)

---

## 1. Prohibición de `any` — usar `unknown`

`any` desactiva TODO el type checking de TypeScript. Usar `unknown` cuando el tipo es incierto; fuerza type narrowing antes de usar el valor.

```ts
// ✅ BIEN: unknown fuerza type narrowing
function procesar(data: unknown): string {
  if (typeof data === 'string') return data.toUpperCase();
  return JSON.stringify(data);
}

// ❌ MAL: any desactiva safety
function procesar(data: any): string {
  return data.toUpperCase(); // runtime error si no es string
}
```

`any` solo como escape hatch con comentario explícito:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- necesario para serialización custom
const serialized: any = customSerializer.encode(payload);
```

**Regla**: Si ves `any` sin comentario, es un bug. Reemplazar con `unknown` o el tipo concreto.

---

## 2. Preferir `as const` sobre `enum`

Usar objetos `as const` + `z.enum()` para constantes del proyecto. Enums nativos solo cuando se necesita **reverse mapping** (string ↔ value bidireccional).

```ts
// ✅ BIEN: as const para constantes
export const CATEGORIAS = {
  OBRA: 'OBRA',
  SERVICIO: 'SERVICIO',
  PRODUCTO: 'PRODUCTO',
} as const;
export type Categoria = (typeof CATEGORIAS)[keyof typeof CATEGORIAS];
export const categoriaSchema = z.enum(['OBRA', 'SERVICIO', 'PRODUCTO']);

// ❌ MAL: enum para constantes simples
enum Categoria { Obra = 'OBRA', Servicio = 'SERVICIO' }

// ⚠️ Enum solo con reverse mapping:
enum HttpStatus {
  OK = 200,
  NotFound = 404,
}
// HttpStatus[200] → 'OK' (solo posible con enum)
```

**Regla**: `as const` por defecto. `enum` solo cuando necesitás `Enum[value]`.

---

## 3. Interfaces para APIs públicas, Types para el resto

| Construct | Cuándo usar | Ejemplos |
|-----------|-------------|----------|
| `interface` | APIs públicas: repositorios, props compartidos, DTOs | `ILicitacionesRepo`, `FeedCardProps`, `CreateLicitacionDTO` |
| `type` | Uniones, intersecciones, tuplas, tipos derivados | `LoadingState`, `LicitacionPreview`, `ApiResponse<T>` |

```ts
// ✅ INTERFAZ: contrato de repositorio (API pública)
export interface ILicitacionesRepo {
  getAll(filtros: FiltroFeed): Promise<Licitacion[]>;
  getById(id: string): Promise<Licitacion | null>;
}

// ✅ INTERFAZ: props de componente compartido
export interface FeedCardProps {
  licitacion: Licitacion;
  onPress: (id: string) => void;
}

// ✅ TYPE: unión de estados
export type LoadingState = 'idle' | 'loading' | 'error' | 'success';

// ✅ TYPE: tipo derivado con utility types
export type LicitacionPreview = Pick<Licitacion, 'id' | 'nombre' | 'monto_label'>;
```

---

## 4. Utility types por defecto

Antes de escribir una interface manual, preguntar: ¿existe un utility type que sirva?

```ts
// ✅ Partial: actualizaciones parciales (PATCH requests)
type UpdateLicitacion = Partial<Licitacion>;

// ✅ Pick/Omit: vistas parciales
type LicitacionCard = Pick<Licitacion, 'id' | 'nombre' | 'estado' | 'monto_label'>;
type LicitacionSinMeta = Omit<Licitacion, 'created_at' | 'updated_at'>;

// ✅ Record: diccionarios tipados
type CategoriaCount = Record<Categoria, number>;

// ✅ ReturnType: inferir tipo de retorno de funciones
type FeedResult = ReturnType<typeof useFeed>;
```

**Regla**: Utility types primero. Interface manual solo cuando el utility type no alcanza.

---

## 5. Generics en repositorios

Patrón obligatorio: `IRepositorio<T>` para todos los repositorios de datos.

```ts
export interface IRepositorio<T> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

// Implementación concreta
export class LicitacionesRepo implements IRepositorio<Licitacion> {
  async getAll(): Promise<Licitacion[]> {
    // ...
  }
  // ...
}
```

**Regla**: Todo repositorio en `core/repositories/` debe implementar `IRepositorio<T>`.

---

## 6. Type predicates post-filter

Después de `.filter()`, TypeScript NO infiere el narrowing automáticamente. Usar type predicates explícitos.

```ts
// ✅ BIEN: type predicate mantiene el tipo
const items: (Licitacion | null)[] = [/* ... */];
const validos = items.filter((item): item is Licitacion => item !== null);
// validos → Licitacion[], no (Licitacion | null)[]

// ❌ MAL: sin predicate, TypeScript no infiere
const mal = items.filter(item => item !== null);
// mal → (Licitacion | null)[] ← pierde el narrowing
```

**Regla**: Siempre que `.filter()` cambie el tipo del array (removiendo null/undefined o discriminando uniones), agregar type predicate.

---

## 7. Zod + `z.infer` como única fuente de verdad

Los tipos de datos de entrada se definen UNA vez en Zod y se infieren con `z.infer`. Nunca duplicar tipos manualmente.

```ts
// ✅ Única fuente de verdad
export const licitacionSchema = z.object({
  id: z.string(),
  nombre: z.string().min(1),
  monto_estimado: z.number().positive().optional(),
  estado: z.enum(['Publicada', 'Adjudicada', 'Desierta']),
  fecha_publicacion: z.string().datetime(),
});

// ✅ Tipo inferido automáticamente
export type Licitacion = z.infer<typeof licitacionSchema>;

// ❌ MAL: duplicar tipo manual
export interface LicitacionManual {
  id: string;
  nombre: string;
  monto_estimado?: number;
  // si el schema cambia, esto queda desactualizado
}
```

**Regla**: Los schemas Zod son la autoridad. Los tipos se infieren, no se escriben a mano.

---

## 8. tsconfig: strict mode

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- `strict: true` → habilita todas las checks estrictas (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.)
- `noUncheckedIndexedAccess: true` → al acceder a un array por índice, el tipo incluye `| undefined`
- No silenciar errores con `// @ts-ignore` o `as any` sin justificación

**Regla**: Si una línea tiene `// @ts-ignore`, debe tener un comentario explicando POR QUÉ.

---

## Referencias

- Companion doc: `docs/plans/typescript-patterns.md`
- Diseño frontend: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Skill `notichilec-frontend` — arquitectura general frontend
- Skill `notichilec-api` — backend Express
