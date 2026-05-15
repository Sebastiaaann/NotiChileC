---
name: notichilec-testing-strategy
description: >
  Estrategia de testing para FrontNotiChileC (Unit + Integration + E2E con Testing Library y Playwright).
  Trigger: Escribir tests, definir cobertura, o configurar tooling de testing.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Escribir tests para componentes, hooks, o utilidades
- Configurar Vitest, Testing Library, o Playwright
- Decidir QUÉ testear y qué no
- Verificar cobertura antes de un PR

## Pirámide de Testing

```
       /\
      /E2E\        ← 5-10%: flujos críticos (Playwright)
     /______\
    /        \
   /Integr.   \   ← 20-30%: containers + hooks (Testing Library)
  /____________\
 /              \
/  Unit Tests    \  ← 60-70%: entidades, utils, validaciones (Vitest)
/_________________\
```

## Qué testear en cada capa

### Core (Unit Tests con Vitest)

**QUÉ**: Entidades de dominio, utilidades, validaciones, schemas de Zod.

**CÓMO**: Tests aislados, sin React, sin DOM.

```ts
// core/entities/__tests__/licitacion.test.ts
import { describe, it, expect } from 'vitest';
import { Licitacion } from '../Licitacion';

describe('Licitacion entity', () => {
  it('calcula montoLabel correctamente', () => {
    const lic = new Licitacion({ montoEstimado: 1000000 });
    expect(lic.montoLabel).toBe('$1.000.000');
  });

  it('valida que el id sea requerido', () => {
    expect(() => new Licitacion({})).toThrow();
  });
});
```

```ts
// schemas de Zod: probar validación
describe('loginSchema', () => {
  it('acepta email válido', () => {
    expect(loginSchema.parse({ email: 'a@b.com', password: '12345678' })).toBeTruthy();
  });

  it('rechaza email inválido', () => {
    expect(() => loginSchema.parse({ email: 'invalido', password: '12345678' }))
      .toThrow();
  });
});
```

### Application (Integration Tests con Testing Library)

**QUÉ**: Containers, hooks, stores de Zustand, queries de TanStack Query.

**CÓMO**: Renderizar componentes con providers mockeados. Testear flujos completos.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeedContainer } from '@/features/feed';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('FeedContainer', () => {
  it('muestra skeleton mientras carga', () => {
    render(<FeedContainer />, { wrapper: createWrapper() });
    expect(screen.getByTestId('feed-skeleton')).toBeInTheDocument();
  });

  it('muestra cards cuando los datos cargan', async () => {
    render(<FeedContainer />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Licitación 1')).toBeInTheDocument();
    });
  });

  it('muestra empty state si no hay datos', async () => {
    render(<FeedContainer />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    });
  });
});
```

### Shared Components (Integration Tests)

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/shared/ui/button';

describe('Button', () => {
  it('renderiza el texto', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('llama onClick al hacer click', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('no llama onClick si está disabled', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('tiene el accessible name correcto', () => {
    render(<Button aria-label="Cerrar"><XIcon /></Button>);
    expect(screen.getByLabelText('Cerrar')).toBeInTheDocument();
  });
});
```

### E2E (Playwright)

**QUÉ**: Flujos críticos completos: login, feed, detalle de licitación.

**CÓMO**: Tests que corren en browser real contra backend de dev/staging.

```ts
// e2e/feed.spec.ts
import { test, expect } from '@playwright/test';

test('usuario ve el feed de licitaciones', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('feed-skeleton')).toBeVisible();
  await expect(page.getByTestId('feed-card')).toBeVisible({ timeout: 10000 });
});

test('usuario puede filtrar por rubro', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Rubro' }).click();
  await page.getByRole('option', { name: 'Construcción' }).click();
  await expect(page).toHaveURL(/rubro=construccion/);
});

test('usuario puede ver detalle de licitación', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('feed-card').first().click();
  await expect(page).toHaveURL(/\/licitacion\//);
  await expect(page.getByTestId('detail-info')).toBeVisible();
});
```

## Coverage Thresholds

```ts
// vite.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        global: {
          functions: 100,
          lines: 80,
          branches: 80,
          statements: 80,
        },
      },
      include: ['src/core/**', 'src/application/**', 'src/shared/**'],
      exclude: ['src/shared/ui/**'], // shadcn components no se testean unitariamente
    },
  },
});
```

**100% en functions**: Toda función exportada debe tener test (especialmente en core/).
**80% en lines/branches**: Realista y alcanzable.

## Principios de Testing

### Testing Library Philosophy

> "Cuanto más tus tests se parecen a cómo se usa el software, más confianza pueden darte."

- NO testear implementación interna (estados, refs, props internas)
- SÍ testear comportamiento visible para el usuario (texto, roles, aria-labels)
- Buscar por `getByRole`, `getByText`, `getByLabelText`
- Evitar `getByTestId` salvo para casos extremos

### Lo que NO testeamos

- shadcn/ui components (son de terceros, ya testeados)
- TanStack Query internals (testear el behavior, no la librería)
- Better Auth internals (testear login/logout/sesión)
- Tipos de TypeScript (corren en build time)
- Constantes o config simples

### Mocks mínimos

```ts
// Para tests de containers, mockear SOLO http
vi.mock('@/infrastructure/api/http-client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// NO mockear entidades, schemas, o utilidades puras
```

## Setup

```bash
# Unit + Integration
bun add -d vitest @testing-library/react @testing-library/jest-dom
bun add -d @testing-library/user-event jsdom

# E2E
bun add -d @playwright/test
npx playwright install
```

## Referencias

- Design doc: `docs/plans/2026-05-15-frontend-architecture-design.md`
- Doc testing: `docs/plans/testing-strategy.md`
- Skill: `notichilec-component-design` (patrones de componentes)
- Skill: `notichilec-frontend` (arquitectura general)
- Skill: `notichilec-performance` (Performance)
