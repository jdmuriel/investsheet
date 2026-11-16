# Plan de trabajo

Estado del proyecto y pasos pendientes. **Se actualiza en cada sesión**: al terminar una tarea se marca `[x]` y se añade una línea al [diario](#diario-de-sesiones).

Documentos de referencia: [especificación](especificacion.md) (qué hay que hacer, requisitos `RF-nn`), [diseño](diseno.md) (cómo) y [descripción de la hoja actual](descripcion-hoja-actual.md).

Dificultad orientativa de cada tarea, para elegir modelo: 🟢 mecánica y acotada · 🟡 normal · 🔴 delicada (cálculo financiero, seguridad o migración de datos).

## Estado actual

- **En producción**: <https://invest.jdmuriel.com>, con inicio de sesión de Google y los datos históricos cargados (3 carteras, 2.918 operaciones).
- **Funciona**: listado de movimientos con acumulados y métricas anuales; alta, edición, duplicado y borrado de operaciones; API para asistentes; descarga y restauración de la base de datos.
- **En la rama, pendiente de visto bueno para fusionar**: mantenimiento de cuentas y valores, exportación de validación con el formato de `Log`, conciliación de saldos y mejoras del listado (acumulados fijos, vista de móvil). Incluye la migración de esquema 4.
- **No existe todavía**: alta rápida por lotes, objetivos anuales, precios, cuadro de cartera, copias automáticas externas.
- La hoja de cálculo sigue siendo la fuente de verdad hasta completar la fase 1 y validar un mes en paralelo.

## Cómo retomar el trabajo en una sesión nueva

1. Leer este fichero y `CLAUDE.md`.
2. `npm ci`, y después `npm run check` y `npm test` para confirmar que todo parte en verde.
3. Los datos reales **no están en el repositorio**. Para trabajar con ellos hay que pedir al propietario una copia descargada desde Ajustes → «Descargar una copia» y dejarla en `data/invest.db`. El Excel original solo hace falta para volver a ejecutar el importador (`legacy/Inversión.xlsx`).
4. Sin datos reales se puede desarrollar igual: las pruebas usan datos inventados.

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
- [ ] **1.9 Alta rápida por lotes** (RF-06): fijar cuenta y tipo e introducir varias líneas seguidas, en cualquier orden de fecha. 🟡
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
- [ ] **1.14 Objetivos anuales** (RF-26): importar los de la cabecera de `Log`, editarlos y mostrar el % de consecución junto a las métricas. 🟢
- [ ] **1.15 Aplicación instalable**: manifiesto e icono. 🟢
- [ ] **1.16 Pruebas de extremo a extremo** de los flujos principales con Playwright. 🟡
- [x] **1.18 API para asistentes** ([documentación](api.md)): consulta de estado y operaciones, y alta, edición y borrado con simulación previa, en `/api/v1` con token (`API_TOKEN`). Lógica en `src/lib/server/api.ts`. 🔴
  - [ ] *Propietario*: crear el secreto `API_TOKEN` en Fly y guardarlo como secreto de red del entorno de Claude Code.
- [ ] **1.19 Servidor MCP con OAuth** sobre la lógica de la API, para usarlo como conector desde la aplicación de Claude (también en el móvil). Antes de empezar, consultar la documentación vigente de conectores personalizados. 🔴
- [ ] **1.17 Periodo en paralelo**: un mes registrando en la hoja y en la aplicación, comparando con la exportación de validación.

## Fase 2 — Cartera y dividendos

Objetivo: poder dejar de usar `Control cartera` y `Variación divs`.

- [ ] **2.1 Migración de esquema**: tablas `price`, `fx_rate`, `dividend_schedule`, `dividend_change`. 🟢
- [ ] **2.2 Hoja de precios.** 🟡
  - [ ] Definir el formato (pestañas `actual` y `cierre`, diseño §5) y dar instrucciones al propietario para crearla y publicarla como CSV.
  - [ ] Lectura con caché de 60 minutos, último precio conocido si falla y corrección manual (RF-43, RF-46).
- [ ] **2.3 Tipos de cambio del BCE** con histórico, y sugerencia del cambio al registrar una operación (RF-03, RF-45). 🟡
- [ ] **2.4 Importar el calendario de dividendos** desde `Control cartera` (dividendo por acción de cada mes). 🟡
- [ ] **2.5 Cuadro de cartera** en `/` (RF-19 a RF-24): tabla por valor, totales, PADI, yields, % recuperado, previsión mensual, gráficos. 🔴
- [ ] **2.6 Cambios de dividendo** (RF-16 a RF-18): una sola acción que versiona el calendario y registra el efecto anual; importar el histórico de `Variación divs`. 🟡
- [ ] **2.7 Exportación de validación con el formato de `Control cartera`.** 🟡

## Fase 3 — Estudio y selección

Objetivo: poder dejar de usar la hoja.

- [ ] **3.1 Valores en estudio** (RF-27 a RF-30): migración de esquema, importación de la solapa, lista y ficha editable, aviso de objetivo sin revisar. 🟡
- [ ] **3.2 Selección mensual** (RF-31 a RF-36): listas ordenables, cierre de revisión con precios del día, importación del histórico mensual, límites por *tier* y zona, texto resumen copiable, registro de propuestas y elección. 🟡

## Fase 4 — Informes e importación de extractos

- [ ] **4.1 Fotos de cartera** al cierre de trimestre y de año (RF-42). 🟡
- [ ] **4.2 Top 50 y su evolución** (RF-37), importando las fotos anuales de la hoja. 🟢
- [ ] **4.3 Dividendos por mes y año** con gráficos (RF-38). 🟢
- [ ] **4.4 Evolución de la inversión** (RF-39). 🟢
- [ ] **4.5 Crecimiento de dividendos**: orgánico frente a compras (RF-40). 🟡
- [ ] **4.6 Importación de extractos CSV** de Degiro e Interactive Brokers (RF-09). 🔴

## Pendiente del propietario

- [ ] Sustituir el secreto `FLY_API_TOKEN` por un token de despliegue limitado a la aplicación `investsheet` y revocar el de organización.
- [ ] Revisar en el informe de importación las filas con fechas fuera de orden (31 en la cartera principal, 16 y 2 en las otras).
- [ ] Decidir si las carteras secundarias muestran el «capital invertido» con el resultado de los años cerrados, como la principal, o solo lo aportado.
- [ ] Medir cuánto tarda el primer arranque tras un rato con la máquina parada.
- [ ] Probar el alta de operaciones con unas cuantas reales.
- [ ] Descargar la exportación de validación adjuntando la hoja y repasar la solapa «Diferencias»: debería mostrar solo las diferencias conocidas (ver más abajo).
- [ ] Rellenar en Ajustes → Valores el nombre de cada valor y marcar como inactivos los que ya no se siguen; revisar nombre y broker de las cuentas.
- [ ] Las solapas de las carteras secundarias no tienen movimientos de 2026 y sus cabeceras de años están desfasadas: ponerlas al día antes del periodo en paralelo, si se quieren validar.
- [ ] Siete compras importadas tienen en la cabecera un ticker distinto del de sus efectos, por erratas de la hoja (`REE`/`RED`, `HCP`/`PEAK`, `3M`/`MMM`, `AMS`/`PM`). Las posiciones están bien; solo afecta a la columna «Valor» del listado.

## Decisiones y hallazgos que conviene recordar

- **Coste por lotes FIFO** en todo el histórico; la plusvalía realizada se muestra aparte y no entra en las «ganancias del año».
- **Venta y recompra el mismo día = traspaso de valores**: los lotes conservan fecha y coste.
- **Modelo de datos**: operación = cabecera + efectos (`cash_leg`, `position_leg`). El motor solo entiende efectos, no tipos de operación.
- **Capital**: la hoja principal suma al capital invertido el resultado de cada año cerrado; las secundarias no. El motor calcula las dos magnitudes.
- **Diferencias conocidas con la hoja**: el resultado de 2025 y, desde enero de 2026, el capital invertido de la cartera principal difieren en el neto de las primas de las dos opciones de 2025; 0,34 € en capital desde julio de 2022 (a una fila de la hoja le falta una fórmula) y el coste de los valores traspasados.
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
