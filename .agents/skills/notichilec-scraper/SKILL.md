---
name: notichilec-scraper
description: >
  Scraper de ChileCompra (Mercado Público) para obtener licitaciones.
  Trigger: Cuando se trabaja con scraping de ChileCompra, parsing de HTML, o fallback del scraper.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Modificar o extender el scraper de ChileCompra
- Debuggear por qué no llegan licitaciones nuevas
- Agregar filtros al scraper (rubro, región, monto)
- Entender el flujo API → Scraper fallback

## Critical Patterns

### Endpoint interno de ChileCompra

```
POST https://www.mercadopublico.cl/BuscarLicitacion/Home/Buscar
Content-Type: application/json; charset=utf-8
```

**Parámetros clave:**
| Campo | Valor | Descripción |
|-------|-------|-------------|
| `idEstado` | `-1` | Todos los estados (igual que la web) |
| `idOrden` | `3` | Últimas publicadas |
| `registrosPorPagina` | `10` | Fijo, no se puede cambiar |
| `pagina` | `0-N` | Paginación |

**NO usar `idEstado: 5`** — devuelve resultados diferentes a la web. Siempre `-1`.

### Parsing del HTML

Cada licitación está en un bloque `<div class="lic-bloq-wrap ...">`:

```typescript
// ID: <span class="clearfix"> XXXX-XX-XX26 </span>
const codigo = extractRegex(block, /<span class="clearfix">\s*([^<]+)<\/span>/);

// URL real: verFicha('http://...')
const url = extractRegex(block, /verFicha\('([^']+)'\)/);

// Monto numérico: campo-numerico-punto-coma
// Monto descriptivo: texto como "Igual o superior a 1.000 UTM"
```

### URL correcta de ficha

```
https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=XXX
```

**NO usar** `buscador.mercadopublico.cl/ficha?code=XXX` — no funciona.

### Montos descriptivos

Guardar en `monto_label` cuando `monto_estimado` es null:
- "Igual o superior a 1.000 UTM e inferior a 2.000 UTM"
- "Entre 100 y 1.000 UTM"
- "Monto superior a 2.000 UTM"

## Flujo Worker

```
1. Scraper SIEMPRE corre primero (200 licitaciones, 20 páginas)
2. API intenta después (enriquecimiento + suplemento)
3. Si API falla → no pasa nada, scraper ya trajo todo
4. ON CONFLICT DO NOTHING para deduplicación
```

## Filtros del scraper (futuro)

```typescript
await scrapeLicitaciones(20, {
  codigoRegion: 13,        // Metropolitana
  idTipoLicitacion: 1,     // L1, LE, LP, etc.
  // Agregar: rubros, monto mínimo/máximo
});
```

## Commands

```bash
# Test scraper directamente
curl -s "https://www.mercadopublico.cl/BuscarLicitacion/Home/Buscar" \
  -X POST -H "Content-Type: application/json" \
  -d '{"textoBusqueda":"","idEstado":-1,"idOrden":3,"pagina":0}'

# Verificar licitaciones en DB
PGPASSWORD=xxx psql -U postgres -d notichilec \
  -c "SELECT id, nombre, created_at FROM licitaciones ORDER BY created_at DESC LIMIT 5;"
```

## Archivos clave

- `server/src/scraper.ts` — Scraper principal
- `server/src/chilecompra.ts` — Cliente API ChileCompra
- `server/src/worker.ts` — Worker que orquesta scraper + API
