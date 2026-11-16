# investsheet

Aplicación web personal para llevar una cartera de acciones de dividendos; sustituye a una hoja de cálculo. Un solo usuario. Idioma del proyecto: español (código en inglés, textos, comentarios y documentación en español).

**Antes de empezar, lee `docs/plan.md`**: estado, tareas pendientes y decisiones. Al terminar una tarea, márcala allí y añade una línea al diario. Requisitos en `docs/especificacion.md`, arquitectura en `docs/diseno.md`.

## Privacidad: el repositorio es público

- Nunca deben entrar en el repositorio importes, nº de acciones, saldos ni dividendos reales, ni en código, pruebas, comentarios, documentación o mensajes de *commit*. Sí pueden aparecer qué valores componen la cartera y los parámetros de la estrategia.
- Tampoco nombres de familiares ni la dirección de correo del propietario.
- Los datos reales viven en `data/` y `legacy/`, excluidos por `.gitignore`. Las pruebas usan datos inventados.

## Comandos

- `npm run dev` — servidor de desarrollo (sin secretos de acceso configurados no pide inicio de sesión).
- `npm run check` — tipos. `npm test` — pruebas. Ambos deben pasar antes de cada *commit*.
- `npm run build` y `node build` — versión de producción.
- `npm run importar -- legacy/Inversión.xlsx data/invest.db` — reimportar la hoja antigua.

## Estructura

- `src/lib/engine/` — motor de cálculo puro (sin base de datos ni red). Importes en céntimos enteros, acciones en millonésimas.
- `src/lib/server/` — SQLite (`node:sqlite`), migraciones en `migrations.ts` (no modificar una ya desplegada: añadir otra), acceso y copias.
- `src/routes/` — pantallas. `scripts/` — importador de la hoja antigua.

## Despliegue

Cada cambio en `main` que no sea solo documentación despliega en Fly.io (`.github/workflows/desplegar.yml`). Se trabaja en una rama y se fusiona en `main` solo con el visto bueno del propietario. Tras un cambio de esquema, la migración se aplica sola al arrancar.

## Convenciones

- SvelteKit 3 y Svelte 5 con *runes*: alias `#lib`, `$app/env`, `Handle` desde `@sveltejs/kit/hooks`. Ante la duda, consultar los tipos en `node_modules/@sveltejs/kit/types`.
- Las importaciones entre ficheros TypeScript llevan extensión `.ts`, para que los scripts funcionen con Node sin compilar.
- La lógica de cálculo va en el motor con pruebas; las rutas solo leen, llaman al motor y pintan.
