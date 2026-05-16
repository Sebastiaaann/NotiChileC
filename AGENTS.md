# AGENTS.md — NotiChileC

## Propósito
Guía de trabajo para agentes en `C:\LicitacionesM\notichilec`.

## Reglas no negociables
- Verificá antes de afirmar: si hay duda, inspeccionar código/docs/comandos primero.
- No hacer `build` después de cambios (salvo pedido explícito del usuario).
- No agregar atribuciones IA ni `Co-Authored-By` en commits.
- Si faltan datos críticos, frená y pedí confirmación antes de ejecutar acciones riesgosas.
- Preferir cambios pequeños, reversibles y con evidencia técnica.

## Stack del proyecto
- Frontend: React Native + Expo Router
- Backend: Node.js + Express + TypeScript
- DB: PostgreSQL
- Push: Expo Push Notifications

## Skills locales del proyecto (usar según contexto)
- `.agents/skills/notichilec-project` → Convenciones globales del repo
- `.agents/skills/notichilec-api` → Backend, worker, rutas, push
- `.agents/skills/notichilec-db` → Schema/SQL/PostgreSQL
- `.agents/skills/notichilec-scraper` → ChileCompra scraping/parsing
- `.agents/skills/expect` → Verificación adversarial browser-facing

## Flujo recomendado
1. Entender contexto y restricciones.
2. Verificar estado actual (git, archivos afectados, contratos).
3. Aplicar cambios mínimos necesarios.
4. Validar con pruebas/comprobaciones permitidas por la tarea (sin build global).
5. Reportar qué cambió, por qué y riesgos.

## Convención de respuesta técnica
- Explicar primero el **por qué** (concepto), luego el **cómo** (implementación).
- Si una idea del usuario es incorrecta, corregir con evidencia y alternativa.
- Cuando haya más de una opción, proponer tradeoffs claros.
