# Plan de trabajo

Estado del proyecto y pasos pendientes. **Se actualiza en cada sesión**: al terminar una tarea se marca `[x]` y se añade una línea al [diario](#diario-de-sesiones).

Documentos de referencia: [especificación](especificacion.md) (qué hay que hacer, requisitos `RF-nn`, y su [grado de avance](especificacion.md#12-grado-de-avance)), [diseño](diseno.md) (cómo), [descripción de la hoja actual](descripcion-hoja-actual.md), [incidencias de la migración](incidencias-migracion.md) (diferencias con la hoja, erratas y fallos de importación) y [hoja de precios](hoja-precios.md).

Dificultad orientativa de cada tarea, para elegir modelo: 🟢 mecánica y acotada · 🟡 normal · 🔴 delicada (cálculo financiero, seguridad o migración de datos).

## Estado actual (21 de noviembre de 2026)

- **En producción**: <https://invest.jdmuriel.com>, con inicio de sesión de Google y los datos históricos cargados (3 carteras, 2.918 operaciones). Todo lo hecho está fusionado en `main`; el esquema va por la migración 9.
- **Funciona (fase 1)**: listado de movimientos con acumulados, métricas anuales y objetivos, con vista de móvil y edición en ventana emergente; alta, edición, duplicado y borrado de operaciones; cartera fija en la barra superior; mantenimiento de cuentas y valores; conciliación de saldos; exportación de validación con el formato de `Log`; API para asistentes (con token, ya activa); descarga y restauración de la base de datos; instalable como aplicación (1.15).
- **Funciona (fase 2)**: cuadro de cartera en la portada, con el orden de `Control cartera` por defecto y editable, columnas de dividendo por meses y ficha del valor en ventana emergente; calendario y cambios de dividendo; precios desde la hoja publicada «investsheet — precios» o a mano; tipos de cambio del BCE; importación de los datos de la hoja que no son operaciones. Comparado valor a valor con `Control cartera`: las diferencias que quedan están explicadas en las [incidencias](incidencias-migracion.md) (C5, C6, C9, C10).
- **Funciona (fase 3)**: selección mensual en `/seleccion` (3.2), ya cargada con la solapa `Selección` y sus 34 revisiones, con la variación coloreada y la evolución del precio de cada valor dibujada. El propietario la usará por primera vez en la revisión de este mes.
- **Migración**: revisadas las erratas de la hoja y corregidas en la aplicación y en la hoja (H2, H11, H13, H14). El resumen está al principio de [incidencias-migracion.md](incidencias-migracion.md).
- **No existe todavía**: copias automáticas externas (1.11), pruebas de extremo a extremo (1.16), servidor MCP (1.19), exportación de validación de `Control cartera` (2.7), valores en estudio (3.1), e informes (fase 4).
- **Mejoras tras el primer uso** (2026-11-21): hecha toda la lista M1.x y M2.x (más abajo), fusionada y desplegada, y corregidos los cambios de dividendo con fecha anterior al calendario importado.
- **Pendiente del propietario**: dejar bien el dividendo de `O` (en su ficha, borrar la versión suelta del calendario del 11/11/2026 y volver a meter el cambio a 0,274 desde el 11/11; el calendario importado tenía 0,27 aunque los cambios anotados llegaban a 0,2715); añadir a la hoja de precios `BMY`, `GOOGL` y los 9 candidatos dados de alta desde `Selección` (AD, DGE, ENX, ASML, META, AMZN, BNTX, NOVO-B, LDA); instalar la aplicación en el móvil y el Chromebook y probar los colores y gráficos de la selección (desplegado el 2026-11-20, sin probar aún por él).
- **Siguiente paso propuesto**: recoger más impresiones del propietario tras usar la aplicación y la selección este fin de semana (la lista de mejoras ya está hecha); después, la copia externa automática (1.11), que es lo que más riesgo quita, y el periodo en paralelo de un mes contra `Log` (1.17). La 2.7 pierde urgencia: la comparación valor a valor ya está hecha.
- La hoja de cálculo sigue siendo la fuente de verdad hasta validar un mes en paralelo.

## Cómo retomar el trabajo en una sesión nueva

1. Leer este fichero y `CLAUDE.md`.
2. `npm ci`, y después `npm run check` y `npm test` para confirmar que todo parte en verde.
3. Los datos reales **no están en el repositorio**. Para trabajar con ellos hay que pedir al propietario una copia descargada desde Ajustes → «Descargar una copia» y dejarla en `data/invest.db`, y una copia de la hoja en `legacy/Inversión.xlsx` (las dos carpetas están en `.gitignore`; un contenedor nuevo empieza sin ellas).
4. Sin datos reales se puede desarrollar igual: las pruebas usan datos inventados.
5. Antes de dar por nueva una diferencia con la hoja, mirar [incidencias-migracion.md](incidencias-migracion.md); si lo es, anotarla allí.
6. Desde el entorno de desarrollo en la nube no se ha comprobado el acceso al servidor del BCE ni a la hoja de precios publicada: sus lecturas se prueban con ficheros de ejemplo.
7. **Datos de la selección en local**: la copia de `data/invest.db` del 19 de noviembre es anterior a la carga de `Selección`. Para ver la pantalla con datos sin tocarla, copiarla al *scratchpad*, aplicarle `applyExtras(db, await readExtras('legacy/Inversión.xlsx'), fecha)` de `src/lib/server/legacy-extras.ts` y arrancar `npm run dev` con `DATA_DIR` apuntando a esa copia.
8. **API de producción desde la sesión**: el token está guardado como secreto de red del entorno de Claude Code para `invest.jdmuriel.com`; basta con `curl https://invest.jdmuriel.com/api/v1/...` sin cabecera de autorización (la pone el proxy). Uso en [api.md](api.md). Así se han hecho las correcciones de datos en producción (`keepEffects`, `PATCH` de valores y de cambios de dividendo).
9. **Desplegar**: con el visto bueno del propietario, fusionar en `main`, mirar si el *push* ha lanzado la acción `desplegar.yml` (desde la sesión unas veces la lanza y otras no); si no, lanzarla a mano (`workflow_dispatch`), y comprobar que responde la versión nueva.
10. **Google**: el conector de Drive puede buscar, crear y descargar ficheros del propietario, pero el de Google Sheets da «Permission denied» con sus hojas: no se pueden editar desde la sesión.

## Fase 1 — Registro de operaciones

Objetivo: poder dejar de usar la solapa `Log`.

- [x] **1.1 Esqueleto del proyecto.** SvelteKit 3 + TypeScript, adaptador Node, Vitest.
- [x] **1.2 Motor de cálculo** (`src/lib/engine`). Lotes FIFO, efectivo por cuenta, capital, resultado del año, métricas anuales. Con pruebas.
- [x] **1.3 Esquema e importador** (`src/lib/server/migrations.ts`, `scripts/importar-legacy.ts`). Importa los tres registros, trata como traspaso las ventas con recompra y genera un informe de diferencias con la hoja.
- [x] **1.4 Listado de movimientos** (`/movimientos`). Acumulados por fila, filtros por cartera, año, tipo y texto, métricas anuales.
- [x] **1.5 Inicio de sesión** con Google, limitado a una dirección (`src/lib/server/auth.ts`, `src/hooks.server.ts`).
- [x] **1.6 Copia y restauración manual** (`/ajustes`).
- [x] **1.7 Despliegue en Fly.io** con acción de GitHub (`.github/workflows/desplegar.yml`), dominio y certificado.
- [x] **1.8 Alta, edición y borrado de operaciones** (RF-01 a RF-05, RF-08). 🔴
  - [x] Funciones puras que, a partir de los campos de un formulario, generan la operación con sus `cash_leg` y `position_leg`, una por tipo de operación (`src/lib/engine/operations.ts`). Con pruebas por tipo.
  - [x] Tipos frecuentes: dividendo, compra, aportación, interés, gasto, traspaso de efectivo, cambio de divisa.
  - [x] Resto de tipos: venta, retirada, derechos (compra, venta, conversión), ampliación liberada, devolución de prima, *split*, *spin-off*, conversión de ticker, traspaso de valores, opciones, promociones y fondos monetarios.
  - [x] Escritura en base de datos en una transacción, con registro en `audit_log` (`src/lib/server/operations.ts`).
  - [x] Formulario `/movimientos/nuevo` con campos según el tipo, descripción generada, vista previa de los efectos y saldo resultante de la cuenta al guardar.
  - [x] Edición y borrado desde la fila del listado (`/movimientos/[id]`, enlazado desde la fecha).
  - [x] Orden dentro del día (`seq`): nuevo al final del día, ajustable desde la pantalla de edición.
  - [x] Validaciones: no vender más de lo que hay (bloquea), aviso de saldo negativo (pide confirmación).
  - [x] Duplicar un movimiento desde su fila del listado (⧉), con la fecha de hoy: las acciones se ponen al día y el importe y las retenciones se recalculan con la misma proporción.
  - [x] Tipo de cambio tecleable al revés (euros por unidad de la moneda); se guarda siempre «moneda por euro» y el navegador recuerda la preferencia.
- [x] **1.10 Mantenimiento de cuentas y valores**: alta y edición desde Ajustes (`/ajustes/cuentas`, `/ajustes/valores`; lógica en `src/lib/server/masters.ts`), con auditoría. Las cuentas cerradas y los valores inactivos dejan de ofrecerse al dar de alta movimientos. 🟢
- [ ] **1.11 Copia externa automática a Google Cloud Storage** (diseño §8.2). 🟡
  - [ ] *Propietario*: crear el *bucket* y una cuenta de servicio con permiso solo sobre él; guardar su clave como secreto.
  - [ ] Subida tras cada cambio (con espera de 2 minutos) y al recibir la señal de parada. 🟡
  - [ ] Regla de ciclo de vida: 60 copias diarias, mensuales indefinidas. 🟢
- [x] **1.12 Exportación de validación con el formato de `Log`** (RF-49), con solapa de diferencias. Desde Ajustes o con `npm run validar`; cálculo en `src/lib/engine/log-export.ts`, libro en `src/lib/server/validation.ts`. 🟡
- [x] **1.13 Mejoras del listado.** 🟢
  - [x] Columnas de acumulados siempre visibles: fijas a la derecha en pantallas anchas.
  - [x] Vista reducida en móvil: resumen de saldos y una línea por movimiento, de lo más reciente a lo más antiguo, con el detalle al tocarla.
  - [x] Periodos del listado: por defecto «Últimos movimientos» (mes anterior completo y mes en curso); además mes, trimestre y año en curso, años anteriores y todos (`src/lib/period.ts`).
  - [x] Lo más reciente a la vista al abrir.
  - [x] Conciliación (`/conciliacion`): introducir el saldo real del broker y ver la diferencia (RF-12). Queda anotada en la tabla `reconciliation` (migración 4).
- [x] **1.14 Objetivos anuales** (RF-26): el importador toma los de la cabecera de cada registro; se editan en Ajustes → Objetivos (`/ajustes/objetivos`, lógica en `src/lib/server/goals.ts`) y el listado muestra su consecución junto a las métricas (`src/lib/engine/goals.ts`). 🟢
- [x] **1.15 Aplicación instalable**: manifiesto, icono propio (también para iOS y como icono «maskable» de Android) y accesos directos a «Nuevo movimiento» y «Movimientos». Sin *service worker* ni uso sin conexión (diseño §2). 🟢
- [ ] **1.16 Pruebas de extremo a extremo** de los flujos principales con Playwright. 🟡
- [x] **1.18 API para asistentes** ([documentación](api.md)): consulta de estado y operaciones, y alta, edición y borrado con simulación previa, en `/api/v1` con token (`API_TOKEN`). Lógica en `src/lib/server/api.ts`. 🔴
  - [x] *Propietario*: crear el secreto `API_TOKEN` en Fly y guardarlo como secreto de red del entorno de Claude Code. Comprobado el 2026-11-19.
- [ ] **1.19 Servidor MCP con OAuth** sobre la lógica de la API, para usarlo como conector desde la aplicación de Claude (también en el móvil). Antes de empezar, consultar la documentación vigente de conectores personalizados. 🔴
- [ ] **1.17 Periodo en paralelo**: un mes registrando en la hoja y en la aplicación, comparando con la exportación de validación.

## Fase 2 — Cartera y dividendos

Objetivo: poder dejar de usar `Control cartera` y `Variación divs`.

- [x] **2.1 Migración de esquema** (6): tablas `price`, `fx_rate`, `dividend_schedule`, `dividend_change`. 🟢
- [x] **2.2 Hoja de precios.** 🟡
  - [x] Formato e instrucciones para crearla y publicarla como CSV: [hoja-precios.md](hoja-precios.md).
  - [x] Lectura con caché de 60 minutos, último precio conocido si falla y corrección manual en `/precios` (RF-43, RF-46). `src/lib/server/market.ts`.
  - [x] *Propietario*: crear la hoja, publicarla y guardar su dirección como secreto `PRICES_CSV_URL` en Fly. Hecho el 2026-11-19 (la hoja «investsheet — precios» de su Drive).
  - [ ] Pestaña `cierre` (precio de cierre de fin de trimestre): se hará con las fotos de cartera (4.1).
- [x] **2.3 Tipos de cambio del BCE** con histórico (se descargan solos; el histórico completo la primera vez), y sugerencia del cambio al registrar una operación (RF-03, RF-45). 🟡
  - [x] Comprobar en producción que la descarga del BCE funciona. Comprobado por el propietario el 2026-11-19.
- [x] **2.4 Importar el calendario de dividendos** desde `Control cartera`, junto con el último precio y cambio de cada valor (`src/lib/server/legacy-extras.ts`). Lo hace el importador y, sobre una base ya en uso, Ajustes → «Importar datos de la hoja». 🟡
- [x] **2.5 Cuadro de cartera** en `/` (RF-19 a RF-24): totales, tabla por valor ordenable y filtrable, previsión de 12 meses y distribución por valor, sector, supersector y país; vista de móvil. Cálculo en `src/lib/engine/portfolio.ts`. 🔴
  - [x] Zona y *tier* de cada valor: se importan de `Selección` (3.2) y se editan en Ajustes → Valores. La zona es España, EE. UU. o resto del mundo: decide la lista de la selección y su inversión máxima, y filtra el cuadro.
  - [x] Orden por defecto de los valores de cada cartera: el de las columnas de `Control cartera` (tabla `portfolio_security`, migración 8), importado con los demás datos de la hoja. Al ordenar por una columna, un botón vuelve a él. Se edita desde el cuadro (M1.9).
  - [ ] RF-22 completo: hoy se muestra lo cobrado desde la última compra en los valores que se reinvierten; falta definir con el propietario qué es «mantener el equilibrio».
- [x] **2.6 Cambios de dividendo** (RF-16 a RF-18) en `/dividendos`: una sola acción versiona el calendario y deja constancia; efecto anual por cartera y total por año; histórico de `Variación divs` importado. 🟡
- [ ] **2.7 Exportación de validación con el formato de `Control cartera`.** 🟡

## Fase 3 — Estudio y selección

Objetivo: poder dejar de usar la hoja.

- [ ] **3.1 Valores en estudio** (RF-27 a RF-30): migración de esquema, importación de la solapa, lista y ficha editable, aviso de objetivo sin revisar. 🟡
- [x] **3.2 Selección mensual** (RF-31 a RF-36) en `/seleccion`: cuatro listas (España, resto del mundo, EE. UU. y sin *tier*) ordenables arrastrando o con flechas; invertido con aviso del máximo por *tier* y zona, RPD, precio, objetivo, distancia y variación desde la última revisión; línea resumen con el formato de la hoja, copiable por valor, por lista o entera; cierre de revisión con el precio del día, propuestas y elección; parámetros editables. Importa de `Selección` las listas, *tiers*, objetivos, parámetros y las 34 revisiones, y da de alta los candidatos que no estaban. Cálculo en `src/lib/engine/selection.ts`, datos en `src/lib/server/selection.ts`, migración 8. 🟡
  - [x] Dibujar la evolución mensual de precios de cada valor: línea en cada fila (columna «Evolución») que al pulsarla despliega el gráfico con el objetivo y el detalle de cada revisión (`src/lib/components/PriceChart.svelte`; serie en `priceSeries` del motor).
  - [x] Variación coloreada: verde si sube y rojo si baja; tono claro a partir de la variación reseñable y oscuro a partir de la grande (`variationTone`).
  - [ ] *Propietario*: tras desplegar, Ajustes → «Importar datos de la hoja» con una copia actual de la hoja (carga `Selección` y el orden de `Control cartera`), y añadir a la hoja de precios los candidatos nuevos.

## Fase 4 — Informes e importación de extractos

- [ ] **4.1 Fotos de cartera** al cierre de trimestre y de año (RF-42). 🟡
- [ ] **4.2 Top 50 y su evolución** (RF-37), importando las fotos anuales de la hoja. 🟢
- [ ] **4.3 Dividendos por mes y año** con gráficos (RF-38). 🟢
- [ ] **4.4 Evolución de la inversión** (RF-39). 🟢
- [ ] **4.5 Crecimiento de dividendos**: orgánico frente a compras (RF-40). 🟡
- [ ] **4.6 Importación de extractos CSV** de Degiro e Interactive Brokers (RF-09). 🔴

## Mejoras pedidas por el propietario (2026-11-21)

Lista de cambios tras usar la aplicación. **Toda hecha y desplegada el 2026-11-21.** Cómo están hechas las ventanas emergentes y las preferencias de pantalla: [diseño §6](diseno.md#6-interfaz).

**Cuadro de cartera (`/`)**

- [x] **M1.1** Cabecera: «Precios actualizados a las [fecha y hora] · gestionar precios y tipos de cambio» en lugar de «Precios del [fecha] · precios y cambios». 🟢
- [x] **M1.2** Quitar la tarjeta «P/G» de los valores. 🟢
- [x] **M1.3** Orden de las tarjetas: PADI bruto · PADI neto · Liquidez · Valor de mercado · Capital aportado. 🟢
- [x] **M1.4** Tarjeta final «Total» = liquidez + valor de mercado, con la línea «resultado total», que sale de «Capital aportado». 🟢
- [x] **M1.5** Quitar la línea «Peso equiponderado» y mostrar ese dato en un aviso (i) en la cabecera de la columna «Peso». 🟢
- [x] **M1.6** Columnas: «Precio» antes de «Coste»; «YOC» detrás de «RPD neta». 🟢
- [x] **M1.7** Desde cada fila: (a) ir a movimientos con todos los movimientos de todos los años de ese ticker; (b) editar el valor en una ventana emergente que, al guardar, refresca la fila. 🟡
  - [x] `/ajustes/valores/[id]` acepta también el ticker.
  - [x] En Ajustes → Valores, la edición también en ventana emergente.
- [x] **M1.8** Dividendo mensual previsto por valor (como las filas 30 a 53 de `Control cartera`): columnas de enero a diciembre que se muestran por acción o en euros totales (se recuerda en la cookie `meses`) y ventana emergente al pulsar el DPA. 🟡
- [x] **M1.9** Editar el orden de los valores de cada cartera (`portfolio_security.sort_order`), para colocar un valor nuevo donde se quiera: «Cambiar el orden de la cartera» en el cuadro, arrastrando o con flechas. Los valores sin posición conservan su sitio (`reorder` del motor). 🟡
- [x] **M1.10** Retoques tras la revisión: cabecera «Precios actualizados: DD/MM/AAAA HH:MM»; tarjeta «Capital aportado y reinvertido» (capital invertido) con «Solo aportación»; PADI neto sin retenciones; «Total» con el resultado en % sobre lo aportado; coste, valor, P/G, cobrado y por reinvertir sin decimales; precio medio y DPA con dos; cabecera «DPA (€)»; cabeceras en dos líneas; «Meses» y «Cambiar el orden» como enlaces a la derecha. 🟢

**Listado de movimientos (`/movimientos`)**

- [x] **M2.1** Repetir abajo el «X de X movimientos» y el botón «Nuevo movimiento». 🟢
- [x] **M2.2** Columnas más estrechas: «Capital invertido» y «Ganancias año» ocultables con un interruptor; las de cuentas, más compactas (fuente estrecha, menos separación); a la izquierda, cabecera «M.» para la moneda y descripción recortada con el texto completo al pasar el ratón. Quizá elegir qué cuentas se ven (no hecho: de momento se ven todas). 🟡
- [x] **M2.3** Edición de un movimiento en ventana emergente; al guardar se refrescan esa fila y las siguientes (acumulados). 🟡
- [x] **M2.4** Recordar si las «Métricas anuales y objetivos» se dejaron abiertas o cerradas (cookie `metricas`, un año; sin ella, cerradas solo en móvil). 🟢
- [x] **M2.5** Listado más compacto: la misma letra pequeña en todas las columnas, menos separación, descripción y tipo más cortos (completos al pasar el ratón), fecha con el año en dos cifras, cambio con cuatro decimales, «Imp. €» y códigos de cuenta en las cabeceras. A 1.500 px de ancho cabe entero con «Últimos movimientos». 🟢

## Aplazado

Tareas que el propietario ha decidido dejar para mucho más adelante; no se abordan sin que lo pida.

- [ ] **1.9 Alta rápida por lotes** (RF-06): fijar cuenta y tipo e introducir varias líneas seguidas, en cualquier orden de fecha. La entrada en cualquier orden ya funciona; falta solo la pantalla de alta rápida. 🟡

## Pendiente del propietario

- [x] Sustituir el secreto `FLY_API_TOKEN` por un token de despliegue limitado a la aplicación `investsheet` y revocar el de organización. Hecho el 2026-11-19.
- [x] Revisar en el informe de importación las filas con fechas fuera de orden (31 en la cartera principal, 16 y 2 en las otras). Solo dos eran erratas (H2).
- [x] Decidir si las carteras secundarias muestran el «capital invertido» con el resultado de los años cerrados, como la principal, o solo lo aportado. **Decidido: como la principal** (véase Decisiones).
- [x] Medir cuánto tarda el primer arranque tras un rato con la máquina parada. **Entre 5 y 10 segundos** (medido por el propietario el 2026-11-21).
- [x] Probar el alta de operaciones con unas cuantas reales. Hecho el 2026-11-21.
- [x] Tras desplegar la fase 2: en Ajustes → «Importar datos de la hoja», subir una copia de la hoja indicando la fecha de sus precios. Carga objetivos, precios, cambios, calendario de dividendos e histórico de cambios de dividendo sin tocar las operaciones.
- [x] Crear la hoja de precios según [hoja-precios.md](hoja-precios.md) y guardar su dirección en el secreto `PRICES_CSV_URL`.
- [x] Repasar el cuadro de cartera contra `Control cartera` (hecho por la sesión el 2026-11-19; véase C5, C6, C9 y C10 en las incidencias). Diferencias esperadas: el coste (FIFO y valores traspasados), el «capital aportado» (la hoja no cuenta la apertura de 2014) y los dividendos cobrados históricos (la hoja los copia a mano).
- [x] La compra del 9 de octubre de 2026 anotada con ticker `AMS` no entra en ninguna columna de la hoja: decidir a qué valor corresponde y corregirla en la aplicación (y en la hoja). Es Amadeus y ya tiene columna.
- [ ] Descargar la exportación de validación adjuntando la hoja y repasar la solapa «Diferencias»: debería mostrar solo las diferencias conocidas (ver más abajo).
- [x] Revisar nombre y broker de las cuentas. (Nombres de los valores e inactivos: hechos.)
- [x] ~~Poner al día las solapas de las carteras secundarias.~~ **Decidido**: las secundarias se llevan ya solo en la aplicación; el periodo en paralelo se valida solo contra `Log`.
- [ ] Añadir `BMY` y `GOOGL` a la hoja de precios (H15).
- [x] Corregir en la hoja la fecha de las dos filas de marzo de 2021 (H2) y la celda del ticker de las filas de la incidencia H13 ([incidencias-migracion.md](incidencias-migracion.md)); en la aplicación las corrige la sesión por la API.

## Decisiones y hallazgos que conviene recordar

- **Capital invertido = aportaciones + resultado de los años cerrados, en todas las carteras**: a final de año se considera que las ganancias se reinvierten en la cartera. En el listado de movimientos se muestra en una sola columna. Las carteras secundarias se llevan solo en la aplicación y no se validan contra la hoja.

- **Coste por lotes FIFO** en todo el histórico; la plusvalía realizada se muestra aparte y no entra en las «ganancias del año».
- **Venta y recompra el mismo día = traspaso de valores**: los lotes conservan fecha y coste.
- **Modelo de datos**: operación = cabecera + efectos (`cash_leg`, `position_leg`). El motor solo entiende efectos, no tipos de operación.
- **Capital**: la hoja principal suma al capital invertido el resultado de cada año cerrado; las secundarias no. El motor calcula las dos magnitudes.
- **Diferencias conocidas con la hoja** (la lista completa y al día está en [incidencias-migracion.md](incidencias-migracion.md)): el resultado de 2025 y, desde enero de 2026, el capital invertido de la cartera principal difieren en el neto de las primas de las dos opciones de 2025; 0,34 € en capital desde julio de 2022 (a una fila de la hoja le falta una fórmula) y el coste de los valores traspasados.
- **Alta de operaciones** (1.8), reglas tomadas de cómo quedaron los datos importados:
  - El cambio es siempre «unidades de la moneda por euro». Importe y retenciones van en la moneda de la operación y los gastos en la de la cuenta. Una cuenta en divisa solo admite operaciones en su moneda.
  - Los **gastos de una compra forman parte del coste** del lote (y además restan del resultado del año), como en la hoja.
  - Si se teclea el total abonado o cargado en la cuenta, los gastos son la diferencia: es la forma de cuadrar céntimos con el broker.
  - La **venta de derechos rebaja el coste reducido** en su importe bruto solo si no lleva retención. Con retención se considera un dividendo y no rebaja coste (decisión del propietario).
  - La **devolución de prima** rebaja siempre el coste reducido y no lleva retención (el formulario no la pide).
  - Las **opciones** (`VENTAOPCION`, `COMPRAOPCION`, valen para *put* y *call*): la prima es renta del año al cobrarla y renta negativa al pagarla. No se llevan como posición: un vencimiento no se anota, un cierre anticipado es la operación contraria y un ejercicio es una compra o venta normal. La hoja anotaba la prima como compra; la migración 3 y el importador convierten las dos operaciones de 2025.
  - En un cambio de divisa se teclea lo que sale y lo que entra de verdad en cada cuenta; los gastos, en euros, son informativos y ya van incluidos en esos importes.
  - Las operaciones **importadas** conservan sus efectos al editarlas (solo cambian fecha, descripción y notas) salvo que se marque «recalcular». Las nuevas guardan los campos tecleados en `operation.input_json` y siempre se regeneran.
  - Las validaciones comparan el registro recalculado con y sin el cambio: solo bloquea o avisa lo que el cambio empeora, no los avisos que ya traía el histórico.
- **Exportación de validación** (1.12):
  - La comparación con la hoja no va fila a fila (el orden dentro del día y las filas de cierre no coinciden): se comparan los importes sumados por fecha, los acumulados al cierre de cada fecha en que la hoja está ordenada y las métricas de la cabecera. Una diferencia que se arrastra solo aparece cuando cambia, y las que siguen vivas se listan al principio como «diferencia vigente».
  - La hoja reinicia las ganancias del año en filas elegidas a mano: el 31 de diciembre y el 1 de enero se admite que lo haya hecho o no.
  - Con la hoja adjunta, las columnas (cuentas, valores, años de la cabecera) se toman de ella; sin ella se usa la disposición conocida (`MAIN_LOG_TICKERS`).
  - Con la hoja de noviembre de 2026 solo salen las diferencias ya conocidas: las de la lista anterior, la apertura de 2014 (la hoja no la anota como aportación) y el coste de los valores traspasados.
  - El libro se escribe en flujo (`WorkbookWriter`): montarlo entero en memoria necesitaba más de los 512 MB de la máquina; así el pico queda en unos 240 MB.
- **Objetivos anuales** (1.14):
  - Métricas con objetivo: las seis de la cabecera de la hoja. Se guardan en `goal` con las claves `capital`, `gross`, `fees`, `grossYield`, `netYield` y `purchases`; una métrica sin fila no tiene objetivo y no se muestra.
  - El de **gastos es un tope**: va bien mientras lo gastado no supere la parte del año transcurrida; en las demás, al revés.
  - El año transcurrido se mide por días (la hoja lo hacía por meses completos).
  - El importador anota los objetivos de la cabecera en el año del último movimiento del libro, no en el que digan los rótulos, que en los registros secundarios están desfasados.
- **Fase 2**:
  - El cuadro usa el **coste reducido** para precio medio, P/G y YOC, como la hoja; el «% recuperado» va sobre el coste de compra.
  - «Capital aportado» es aportaciones menos retiradas según el registro; el resultado total es valor de mercado + liquidez − capital aportado.
  - Con los datos de la hoja de noviembre de 2026 el cuadro da el mismo valor de mercado, liquidez, PADI bruto y neto y tipo de retención que `Control cartera`.
  - **Peniques**: precios y dividendos de Londres llegan en `GBX`; se convierten a libras al leerlos (hoja antigua y hoja de precios) y dentro todo va en `GBP`.
  - Un **precio a mano** no lo pisa la hoja de precios ese mismo día; al día siguiente vuelve a mandar la hoja.
  - La importación de datos de la hoja **nunca pisa**: solo añade precio o cambio a quien no tenga uno de esa fecha o posterior, calendario al valor que no tiene ninguno, cambios de dividendo si no hay ninguno anotado y objetivos a la cartera que no los tiene ese año.
  - El calendario importado entra en vigor en la fecha de los precios de la hoja: el PADI de fechas anteriores no se puede reconstruir, solo los cambios.
  - **Fallo de importación corregido**: cinco compras con el ticker mal tecleado (`REE`, `HCP`, `3M`) se habían importado dos veces, una en el valor bueno y otra en uno fantasma. La migración 7 borra el lote sobrante y el importador ya no lo crea.
- **Cambios de dividendo con fecha pasada**: el calendario «de antes» es el vigente en la fecha del cambio o, si la fecha es anterior a todas las versiones, la primera (el calendario importado lleva la fecha de la importación aunque ya regía antes). Al guardar se quitan las versiones posteriores seguidas que repetían ese calendario anterior, porque lo volverían a poner; quedan en la auditoría y se reponen si se borra el cambio. Borrar un cambio quita también la versión del calendario que anotó. En la ficha del dividendo se puede borrar una versión suelta. El tipo de cambio en blanco es el del BCE de la fecha del cambio (o el último día hábil anterior). Fallo encontrado por el propietario el 2026-11-21 con `O`.
- **Cartera en uso**: se elige en la barra superior y queda recordada en una *cookie* (`src/hooks.server.ts` la deja en `locals.portfolioId`). Un parámetro `cartera` en la dirección manda sobre ella y pasa a ser la recordada; los formularios lo llevan en su dirección de envío para que una pestaña antigua guarde siempre en la cartera que mostraba. Las cargas que dependen de la cartera leen ese parámetro para repetirse al cambiarla.
- **API**: escritura directa (decisión del propietario), sin propuestas pendientes de confirmar; la red de seguridad es la simulación (`dryRun`), las validaciones y el registro de auditoría. Solo se entra con su token, nunca con la sesión del navegador.
- **Fly.io**: región `cdg` (Madrid está retirada). La máquina se para sola sin tráfico.
- **SvelteKit 3** cambia nombres respecto a versiones anteriores: alias `#lib` (no `$lib`), `$app/env` (no `$app/environment`), tipo `Handle` en `@sveltejs/kit/hooks`, y `redirect` no admite destinos externos.

## Diario de sesiones

| Fecha | Hecho |
|---|---|
| 2026-11-15 | Análisis de la hoja, especificación 1.0 y diseño. Tareas 1.1 a 1.7: motor, importador, listado, inicio de sesión, copia manual y primer despliegue. Datos históricos cargados en producción. |
| 2026-11-16 | Tarea 1.8: generación de efectos por tipo de operación, escritura con auditoría, formularios de alta y edición, borrado, orden dentro del día y validaciones. Migración de esquema 2 (`input_json`). |
| 2026-11-16 | Regla de la venta de derechos: solo rebaja el coste reducido si no lleva retención. |
| 2026-11-16 | Opciones: la prima pasa a ser renta del año; tipos genéricos de venta y compra de opción; migración de esquema 3. Confirmada la regla de gastos de compra dentro del coste. |
| 2026-11-16 | Devolución de prima sin retención. Tarea 1.18: API JSON con token para consultar y anotar operaciones desde un asistente. |
| 2026-11-16 | Duplicar movimientos desde el listado y tipo de cambio inverso en el formulario. |
| 2026-11-16 | Periodos en el listado de movimientos, con «últimos movimientos» por defecto. |
| 2026-11-16 | Tareas 1.10, 1.12 y 1.13: mantenimiento de cuentas y valores, exportación de validación con solapa de diferencias, conciliación de saldos (migración de esquema 4), acumulados fijos, vista de móvil y lo más reciente a la vista. |
| 2026-11-16 | La cartera queda fija: se elige en la barra superior y se recuerda entre visitas; desaparece el selector de cada pantalla. |
| 2026-11-16 | Formato de importes: separador de miles siempre (salvo en campos de entrada) y sin mezclar código y símbolo de moneda: código en las pantallas de entrada, símbolo en los listados. Norma añadida a `CLAUDE.md`. |
| 2026-11-16 | Tres totales numéricos de `Control cartera` se habían importado como valores: el importador ya solo acepta textos con forma de ticker y la migración 5 los borra. |
| 2026-11-16 | Fusionado en `main` lo pendiente de la rama. La tarea 1.9 (alta rápida por lotes) queda aplazada por decisión del propietario. |
| 2026-11-16 | Tarea 1.14: objetivos anuales por cartera, con edición en Ajustes, consecución en el listado de movimientos e importación desde la cabecera de la hoja. |
| 2026-11-16 | Fase 2, tareas 2.1 a 2.6: precios (hoja publicada y a mano), tipos de cambio del BCE con sugerencia en el formulario, calendario y cambios de dividendo, cuadro de cartera e importación de los datos de `Control cartera` y `Variación divs`. Corregida la duplicación de cinco compras importadas (migración 7). |
| 2026-11-16 | Fusionadas en `main` la tarea 1.14 y la fase 2. Nuevo fichero de incidencias de la migración y grado de avance por requisito en la especificación. |
| 2026-11-19 | El propietario ha importado en producción los datos de la hoja (Ajustes → «Importar datos de la hoja») y ha creado la hoja de precios. En curso: comprobaciones en producción, revisión de datos maestros y cambio del token de despliegue. |
| 2026-11-19 | Creada la hoja de precios en Drive y configurado `PRICES_CSV_URL`; activada la API con `API_TOKEN` en Fly y el mismo token como secreto de red del entorno de Claude Code, comprobado con `GET /api/v1`. |
| 2026-11-19 | Corrección de valores: una operación importada puede cambiar de valor sin recalcularse (formulario y API, con `keepEffects`); borrado de valores sin usos (Ajustes y API) y `PATCH /api/v1/valores/{ticker}`. Decididos el capital de las secundarias (como la principal) y que las secundarias ya no se validan contra la hoja. |
| 2026-11-19 | Desplegado lo anterior (lanzado a mano: los *push* desde la sesión no disparan la acción). En producción, por la API: corregido el valor de 41 operaciones de H13, borrados 7 valores erróneos, puestos los nombres de los valores y marcados como inactivos los que ya no se siguen (todos los sin posición salvo `GIS`). |
| 2026-11-19 | Corrección de monedas mal anotadas en operaciones importadas (`keepEffects` con `currency`) y en cambios de dividendo (`/api/v1/cambios-dividendo`); retenciones en el `PATCH` de valores. Desplegado y aplicado: 7 dividendos (H14), 3 cambios de dividendo (H11), dos fechas de marzo de 2021 pasadas a mayo (H2) y ficha de `BMY` y `GOOGL` (H15). Estado de la migración resumido al principio de `incidencias-migracion.md`. |
| 2026-11-19 | El propietario ha corregido en la hoja las filas de H2 y H13 y ha puesto nombre a las cuentas. Siguiente sesión: comparar el cuadro de cartera con `Control cartera` valor a valor (P6, P7) con una hoja puesta al día. |
| 2026-11-19 | Tarea 3.2: selección mensual en `/seleccion` con importación de la solapa `Selección` y su histórico; zona (España, EE. UU., resto del mundo), *tier*, precio objetivo y dividendo estimado en la ficha del valor; orden por defecto de los valores de cada cartera según `Control cartera`. Migración 8. Marcados los pasos del propietario de 1.18, 2.2 y 2.3. |
| 2026-11-19 | Comparado el cuadro de cartera con `Control cartera` de la hoja del día (P6): acciones y dividendo previsto coinciden; capital aportado, coste y cobrado difieren por causas conocidas (C5, C6, C9, C10). Pendiente decidir qué cuenta como cobrado (P10). |
| 2026-11-19 | «Cobrado» y «% recuperado» del cuadro suman también devoluciones de prima y ventas de derechos (decisión P10); el motor los lleva aparte (`returnsGross`), sin tocar «Por reinvertir». |
| 2026-11-19 | El propietario ha cambiado `FLY_API_TOKEN` por un token de despliegue limitado a la aplicación. |
| 2026-11-20 | Tarea 1.15: aplicación instalable (manifiesto e iconos; Chromium no da ningún error de instalabilidad). Selección: variación coloreada según los umbrales y evolución del precio de cada valor en las revisiones, con gráfico desplegable. |
| 2026-11-20 | Fusionado en `main` y desplegado (el *push* desde la sesión lanzó la acción por sí solo). |
| 2026-11-21 | Lista de mejoras del propietario (M1.x, M2.x). Hechas M1.1 a M1.6 en el cuadro de cartera: cabecera con la hora de la última lectura de precios, tarjetas reordenadas con «Total» y sin «P/G», peso equiponderado en un (i) de la columna «Peso», columnas «Precio» y «YOC» movidas. M2.4: el listado de movimientos recuerda si las métricas anuales están abiertas. M1.7: desde cada valor de la cartera, su ficha en ventana emergente (`SecurityDialog`, también en Ajustes → Valores; con Ctrl se abre la página) y sus movimientos de todos los años (`/movimientos?periodo=todos&valor=TICKER`); la ficha admite el ticker en la dirección. Fusionado en `main`. |
| 2026-11-21 | M1.8, M1.9 y M2.1 a M2.3: columnas de meses y detalle del DPA en el cuadro; edición del orden de la cartera; en movimientos, barra repetida abajo, columnas más estrechas con «Capital invertido» y «Ganancias año» ocultables (cookie `acumulados`) y edición en ventana emergente (`OperationDialog`, que reutiliza `OperationEditor` de la página del movimiento). Fusionado en `main`. |
| 2026-11-21 | Retoques del propietario: M1.10 (tarjetas, redondeos y cabeceras del cuadro) y M2.5 (listado de movimientos más compacto). Añadida a `CLAUDE.md` la frase sobre la responsabilidad de Claude en el diseño. Fusionado en `main`. |
| 2026-11-21 | El propietario ha probado el alta de operaciones reales y medido el primer arranque con la máquina parada: entre 5 y 10 segundos. |
| 2026-11-21 | Actualizado el estado del plan y el diseño (§6: ventanas emergentes y preferencias en *cookies*) para empezar la siguiente sesión con el contexto limpio. |
| 2026-11-21 | Corregidos los cambios de dividendo con fecha anterior al calendario importado (salía «de 0 a…» y el calendario importado seguía mandando); borrar un cambio deshace su versión del calendario; versiones borrables en la ficha; la pista del tipo de cambio es la de la fecha del cambio. Fusionado en `main`. |
| 2026-11-21 | Skill `add_movement` (`.claude/skills/`) para anotar operaciones por la API sin leer la documentación. Retenciones de las cuentas extranjeras (DEGIRO, DEGIRO2, IBUSD, IBEUR): las importadas solo guardan el total, sin reparto entre origen y destino, así que no hay datos que cambiar; el «destino» que se ve al editarlas es solo lo que propone el formulario. |
| 2026-11-21 | Cuentas de broker extranjero (migración 9, `account.foreign_broker`, marcada en DEGIRO, DEGIRO2, IBUSD e IBEUR y editable en Ajustes → Cuentas): al editar un dividendo importado de esas cuentas se propone su retención en origen, y en el alta el formulario ya no sugiere retención en destino. Fusionado en `main`. |
| 2026-11-22 | Selección: manejo con el teclado (pulsar una fila la selecciona; `j`/`k` cambian de fila, `Ctrl+j`/`Ctrl+k` la mueven, `c` copia su línea, `g` abre su gráfico, `Esc` quita la selección), botón «copiar» en cada línea, raya donde caerá la fila al arrastrar; sin la columna Máximo (el invertido sale en naranja cerca del máximo y en rojo por encima, sin decimales); gráfico pequeño de los últimos 24 meses con rayas de principio de año y grande de hasta 5 años; las compras del valor se marcan con una raya morada en los dos, y en el grande con las acciones y el total. Fusionado en `main`. |
| 2026-11-22 | Node 26 (la LTS actual) en la imagen y en la comprobación del despliegue, y `actions/checkout` y `actions/setup-node` en v7 (quita el aviso de Node 20). `@types/node` pasa a dependencia directa: solo llegaba como opcional de otro paquete y el npm de Node 26 no la instala. Desplegado y respondiendo. |
| 2026-11-22 | Selección, gráfico grande: rótulo de cada compra con acciones, precio por acción y total, rayas de principio de año, y debajo la tabla de las 24 últimas variaciones de revisión a revisión con los colores de la hoja y el recuento de subidas y bajadas reseñables y fuertes (`reviewVariations` en el motor). |

## Ideas para más adelante

- [ ] **Separar el capital invertido en aportaciones y capital reinvertido** (resultado de los años cerrados), para consultarlo aparte. En el listado de movimientos sigue siendo una sola columna. 🟢
