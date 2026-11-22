# investsheet

Aplicación web personal para llevar una cartera de acciones de dividendos; sustituye a una hoja de cálculo. Un solo usuario. Idioma del proyecto: español (código en inglés, textos, comentarios y documentación en español).

Claude, you are the owner and long-term maintainer of this codebase, and its design is up to you.

**Antes de empezar, lee `docs/plan.md`**: estado, tareas pendientes y decisiones. Al terminar una tarea, márcala allí y añade una línea al diario. Requisitos en `docs/especificacion.md`, arquitectura en `docs/diseno.md`. Las diferencias con la hoja antigua, sus erratas y los fallos de importación se anotan en `docs/incidencias-migracion.md`: consúltalo antes de investigar una diferencia y añade allí las nuevas.

## Privacidad: el repositorio es público

- Nunca deben entrar en el repositorio importes, nº de acciones, saldos ni dividendos reales, ni en código, pruebas, comentarios, documentación o mensajes de *commit*. Sí pueden aparecer qué valores componen la cartera y los parámetros de la estrategia.
- Tampoco nombres de familiares ni la dirección de correo del propietario.
- Los datos reales viven en `data/` y `legacy/`, excluidos por `.gitignore`. Las pruebas usan datos inventados.

## Comandos

- `npm run dev` — servidor de desarrollo (sin secretos de acceso configurados no pide inicio de sesión).
- `npm run check` — tipos. `npm test` — pruebas. Ambos deben pasar antes de cada *commit*.
- `npm run build` y `node build` — versión de producción.
- `npm run importar -- legacy/Inversión.xlsx data/invest.db` — reimportar la hoja antigua.
- `npm run validar -- data/invest.db salida.xlsx [legacy/Inversión.xlsx] [desde]` — exportación de validación con el formato de la hoja; con la hoja como referencia añade la solapa de diferencias. El libro contiene datos reales: no versionarlo.

## Estructura

- `src/lib/engine/` — motor de cálculo puro (sin base de datos ni red). Importes en céntimos enteros, acciones en millonésimas. `operations.ts` genera los efectos de cada tipo de operación a partir del formulario; lo usan igual el servidor y la vista previa del navegador. `log-export.ts` calcula el registro con la disposición de la solapa `Log` y sus diferencias con la hoja. `portfolio.ts` calcula el cuadro de cartera a partir de posiciones, precios, cambios y calendario de dividendos; `market.ts` interpreta las fuentes de precios y cambios; `dividends.ts`, los cambios de dividendo.
- `src/lib/server/` — SQLite (`node:sqlite`), migraciones en `migrations.ts` (no modificar una ya desplegada: añadir otra), acceso y copias. `market.ts` guarda y pone al día precios (hoja publicada en `PRICES_CSV_URL`) y tipos de cambio (BCE); `legacy-extras.ts` lee de la hoja antigua lo que no son operaciones.
- `src/routes/` — pantallas, y la API para asistentes en `src/routes/api/v1` (lógica en `src/lib/server/api.ts`, uso en `docs/api.md`). Servidor MCP en `/mcp` con OAuth propio (herramientas en `src/lib/mcp/`, autorización en `src/lib/server/oauth.ts`, uso en `docs/mcp.md`). `scripts/` — importador de la hoja antigua.

## Despliegue

Cada cambio en `main` que no sea solo documentación despliega en Fly.io (`.github/workflows/desplegar.yml`). Se trabaja en una rama y se fusiona en `main` solo con el visto bueno del propietario. Tras un cambio de esquema, la migración se aplica sola al arrancar. Un *push* a `main` hecho desde una sesión de Claude Code en la nube unas veces lanza la acción y otras no: tras el *push*, mirar si aparece una ejecución de `desplegar.yml`; solo si no aparece, lanzarla a mano (`workflow_dispatch`). En los dos casos, comprobar que la nueva versión responde.

## Convenciones

- SvelteKit 3 y Svelte 5 con *runes*: alias `#lib`, `$app/env`, `Handle` desde `@sveltejs/kit/hooks`. Ante la duda, consultar los tipos en `node_modules/@sveltejs/kit/types`.
- Las importaciones entre ficheros TypeScript llevan extensión `.ts`, para que los scripts funcionen con Node sin compilar.
- La lógica de cálculo va en el motor con pruebas; las rutas solo leen, llaman al motor y pintan.
- **Importes**: al mostrarlos llevan siempre separador de miles («1.234,56», también con cuatro cifras), con las funciones de `src/lib/format.ts`; nunca `toFixed` ni `Intl` por libre. La excepción son los campos de entrada, que van sin separador de miles.
- **Monedas**: no se mezclan en una misma pantalla el código (`EUR`) y el símbolo (`€`). En las pantallas de entrada de datos (formularios, conciliación, mantenimiento) se usa siempre el código: `EUR`, `USD`, `GBP`. En los listados, al mostrar importes, el símbolo (`amount()` y `symbol()` de `format.ts`). En caso de duda, el código.
