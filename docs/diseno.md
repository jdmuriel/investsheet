# Diseño

Diseño técnico de la herramienta descrita en la [especificación](especificacion.md). **Estado: borrador para revisión.** Las cuestiones que necesitan decisión están en [§10](#10-cuestiones-abiertas).

## 1. Resumen

Una única aplicación web, desplegada como un contenedor en Fly.io, que se para sola cuando no se usa. Los datos viven en un fichero SQLite sobre un volumen persistente. Todo lo calculable (saldos, posiciones, coste, métricas) se recalcula a partir de las operaciones en cada consulta; no hay tablas de acumulados que puedan desincronizarse.

```
Navegador (Chromebook / Android, PWA)
        │ HTTPS  invest.jdmuriel.com
        ▼
Proxy de Fly ── arranca la máquina con la primera petición, la para al quedar inactiva
        ▼
Aplicación (SvelteKit + Node)
  ├─ interfaz y API
  ├─ motor de cálculo (funciones puras sobre la lista de operaciones)
  └─ SQLite en /data (volumen de Fly)
        │
        ├─► Hoja de Google publicada como CSV ─ precios
        ├─► BCE ─ tipos de cambio oficiales
        ├─► Google ─ inicio de sesión
        └─► Google Cloud Storage ─ copia externa
```

## 2. Tecnología

| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript, en interfaz y servidor | Un solo lenguaje y un solo proyecto |
| Framework | SvelteKit con adaptador Node | Páginas renderizadas en servidor, formularios sencillos, poco código de cliente |
| Base de datos | SQLite con el módulo integrado de Node (`node:sqlite`) y migraciones SQL propias | Un fichero; sin dependencias nativas que compilar; sobra para un usuario |
| Decimales | Enteros: céntimos para importes y millonésimas para acciones | Evitar errores de coma flotante sin añadir dependencias |
| Hoja de cálculo | ExcelJS | Importar la hoja antigua y generar la exportación de validación |
| Gráficos | Chart.js | Suficiente para barras, líneas y sectores |
| Pruebas | Vitest (motor de cálculo) y Playwright (flujos principales) | |
| Contenedor | Imagen Node *slim* de varias etapas | Imagen pequeña: se paga por GB mientras la máquina está parada |

La aplicación es instalable (`static/manifest.webmanifest`, iconos en `static/`) pero **no funciona sin conexión**: sin servidor no hay datos. No lleva *service worker*: Chrome ya no lo exige para instalar y así nunca se muestran datos de una caché antigua. Los ficheros de `static/` se sirven antes de comprobar la sesión, porque el navegador pide el manifiesto sin *cookies*. Los PNG se generan a partir de `icon.svg` e `icon-maskable.svg` (la versión «maskable» deja el dibujo dentro de la zona segura, el 80 % central).

## 3. Modelo de datos

Importes en **céntimos enteros** de su moneda. Cantidades, precios y tipos de cambio como **texto decimal** (hay precios con 5 decimales, cambios con 9 y factores de *split* fraccionarios). Fechas como `AAAA-MM-DD`.

```
portfolio(id, name)
account(id, portfolio_id, code, name, broker, currency, sort_order, closed, foreign_broker)
security(id, ticker, price_ticker, name, country, currency, sector, supersector,
         zone, tier, wht_source_pct, wht_dest_pct, reinvest, active)

operation(id, portfolio_id, date, seq, type, account_id, security_id,
          quantity, price, currency, fx_rate,             -- datos informativos
          amount_local, tax_local, wht_source_local, wht_dest_local, fees_local,
          gross_eur, tax_eur, fees_eur,                   -- contravalor guardado
          capital_in_eur, capital_out_eur, purchase_eur,
          description, notes, source, legacy_ref, input_json, created_at, updated_at)
cash_leg(operation_id, account_id, amount)                -- efecto en efectivo
position_leg(operation_id, security_id, kind, shares, cost_eur, reduced_cost_eur,
             proceeds_eur, to_security_id)                -- efecto en la posición

reconciliation(id, account_id, date, real_balance, computed_balance, notes, created_at)
goal(portfolio_id, year, metric, amount_eur)
setting(key, value)
audit_log(id, at, entity, entity_id, action, before_json, after_json)
```

Fase 2 (migración 6):

```
price(security_id, date, price, currency, source)          -- source: sheet | manual | legacy
fx_rate(currency, date, rate, source)                      -- unidades de la moneda por euro; source: ecb | legacy
dividend_schedule(security_id, valid_from, currency, months_json)   -- 12 importes por acción, enero a diciembre
dividend_change(id, security_id, date, old_annual, new_annual, currency, fx_rate, url, note)
```

Los precios y dividendos de valores que cotizan en peniques se guardan en libras. Las acciones y el efecto en euros de un cambio de dividendo no se guardan: se calculan por cartera con las acciones que había en la fecha.

Las tablas de fases posteriores se añaden con su propia migración cuando se implementan. La 8 añade el orden por defecto de los valores de cada cartera (`portfolio_security`), el precio objetivo y el dividendo estimado del valor, y la selección mensual: `selection_entry` (valores de la selección de cada cartera y su posición; la lista sale de zona y *tier*), `selection_review` (revisión cerrada: fecha, propuestas y elección) y `selection_review_item` (lista, posición y precio de cada valor ese día). Los parámetros (máximos por *tier* y umbrales) van en `setting`.

Puntos de diseño:

- **Orden**: las operaciones se ordenan por `(date, seq)`. `seq` se asigna al final del día al crearla y se puede cambiar a mano; por eso se pueden introducir en cualquier orden.
- **Operación = cabecera + efectos**: cada operación guarda sus efectos como filas aparte. Un `cash_leg` es un movimiento de efectivo en una cuenta (un cambio de divisa o un traspaso tienen dos). Un `position_leg` es un efecto sobre un valor, de cuatro clases: `buy` (lote nuevo), `sell` (baja por FIFO), `adjust` (reparto de acciones o coste entre los lotes vivos: liberadas, *splits*, derechos, primas) y `convert` (los lotes pasan a otro valor). El formulario de cada tipo de operación genera sus efectos, que quedan guardados y son editables; el motor solo entiende efectos, no tipos. El coste que **sale** en una venta no se guarda: lo calcula el motor (§4.2).
- **Contravalor en euros guardado**, no recalculado: es el que se usó al registrar la operación.
- **Calendario de dividendos versionado** por `valid_from`: cada cambio de dividendo crea una versión nueva y conserva las anteriores, de modo que el PADI de una fecha pasada se puede reconstruir.
- **Campos del formulario guardados** (`input_json`): las operaciones dadas de alta en la aplicación conservan lo tecleado, para reeditarlas y regenerar sus efectos. Las importadas no lo tienen y conservan sus efectos al editarlas, salvo que se pida recalcularlos.
- **Registro de auditoría**: cada alta, edición o borrado guarda el antes y el después, para poder deshacer un error.

## 4. Motor de cálculo

Un módulo sin dependencias de base de datos ni de red: recibe la lista ordenada de operaciones de una cartera y devuelve, para cada operación, el estado acumulado tras ella.

```
estado = {
  efectivo por cuenta,
  capital aportado,
  resultado acumulado del año,
  por valor: { lotes de compra (fecha, acciones, coste, coste reducido),
               acciones, coste y coste reducido como suma de los lotes,
               dividendos brutos cobrados, cobrado desde la última compra,
               plusvalía realizada }
}
```

De ese recorrido salen el listado de movimientos (RF-07), el estado a cualquier fecha (RF-10 a RF-14), las métricas anuales (RF-25) y la base del cuadro de cartera. Con unas 5.000 operaciones el recorrido completo tarda milisegundos, así que se hace en cada petición y se guarda en memoria mientras no cambien los datos.

### 4.1 Efecto de cada tipo de operación

| Tipo | Efectivo | Acciones | Coste | Coste reducido | Resultado |
|---|---|---|---|---|---|
| Compra | − importe − gastos | + cantidad | + importe + gastos | + importe + gastos | − gastos |
| Venta | + importe − gastos | − cantidad | − coste FIFO de lo vendido | − coste reducido FIFO de lo vendido | − gastos |
| Dividendo, interés, promoción | + bruto − retenciones − gastos | | | | + neto |
| Devolución de prima | + importe | | | − importe | + importe |
| Aportación / retirada | ± importe | | | | (capital ±) |
| Traspaso | − en origen, + en destino | | | | |
| Cambio de divisa | − en una cuenta, + en otra | | | | − gastos |
| Gasto o comisión | − importe | | | | − importe |
| Compra de derechos | − importe − gastos | | + importe + gastos | + importe + gastos | − gastos |
| Venta de derechos sin retención | + bruto − gastos | | | − bruto | + neto |
| Venta de derechos con retención | + bruto − retención − gastos | | | | + neto |
| Conversión de derechos, ampliación liberada | | + cantidad, repartida entre los lotes | | | |
| Traspaso de valores entre cuentas | | sin cambio | sin cambio | sin cambio | − gastos |
| *Split* / contrasplit | | × factor | | | |
| *Spin-off* | + picos, si los hay | + en el valor nuevo | reparto manual | reparto manual | + picos |
| Conversión de ticker | | pasa al valor nuevo | pasa al valor nuevo | pasa al valor nuevo | |
| Venta / compra de opción (*put* o *call*) | ± prima − gastos | | | | ± prima − gastos |
| Pérdidas / compensación de fondos | ± importe | | | | ± importe |

La prima de una opción es renta del año al cobrarla o pagarla; la hoja la anotaba como compra. Un vencimiento sin ejercer no se anota, un cierre anticipado es la operación contraria y un ejercicio es una compra o venta normal al precio de ejercicio. Los gastos de una compra forman parte del coste del lote y, además, restan del resultado del año: así lo hace la hoja. Esta tabla reproduce lo observado en ella. La migración la valida: si el motor no da los mismos saldos y posiciones que la hoja a cierre de cada año, la regla está mal.

### 4.2 Lotes y FIFO

El coste de un valor es la suma del coste de sus **lotes** vivos; el precio medio es ese coste dividido por las acciones. Son dos magnitudes distintas que salen de los mismos lotes.

- Cada compra crea un lote con su fecha, acciones y coste original.
- Una venta consume los lotes **más antiguos primero**. El coste que sale es el de las acciones consumidas; lo que queda conserva su coste original.
- FIFO se aplica por valor dentro de cada cartera, sin distinguir la cuenta o el broker donde estén las acciones.
- Las acciones recibidas sin desembolso (ampliación liberada, conversión de derechos) se reparten entre los lotes existentes en proporción a sus acciones: cada lote tiene más acciones con el mismo coste. Si se compraron derechos para completar la suscripción, su importe se añade al coste de esos lotes.
- Un *split* multiplica las acciones de cada lote; el coste no cambia.
- La venta de derechos sin retención y la devolución de prima reducen el **coste reducido** de los lotes vivos en proporción; el coste original no se toca. Una venta de derechos con retención se considera un dividendo y no rebaja coste.
- Una conversión de ticker traslada los lotes al valor nuevo; un traspaso entre cuentas no los altera.
- La **plusvalía realizada** de una venta (importe − coste FIFO − gastos) se calcula y se muestra como dato aparte. No se suma a las «ganancias del año», que siguen recogiendo solo rentas menos gastos, como en la hoja, para que los objetivos anuales sean comparables.

Los lotes no se guardan: se reconstruyen en cada recorrido de las operaciones, de modo que corregir una compra antigua actualiza todo lo posterior.

### 4.3 Cálculos con precios

El cuadro de cartera combina el estado del motor con el último precio, el tipo de cambio y el calendario de dividendos vigente, según las fórmulas del §6 de la especificación. No se guarda nada; solo las fotos (`snapshot`) congelan valores.

## 5. Precios y tipos de cambio

**Precios**: una hoja de Google con una fila por valor y dos pestañas publicadas como CSV:

| Pestaña | Columnas | Fórmula |
|---|---|---|
| `actual` | ticker, precio, moneda, fecha y hora | `GOOGLEFINANCE(ticker; "price")` |
| `cierre` | ticker, fecha de cierre, precio | precio de cierre en el último fin de trimestre, con la fecha calculada en la propia hoja |

La aplicación lee `actual` cuando la última lectura tiene más de 60 minutos y alguien abre el cuadro de cartera, sin hacerle esperar más de 4 segundos (si tarda más, se pinta con lo guardado). Cómo montar la hoja: [hoja-precios.md](hoja-precios.md). La pestaña `cierre` permite generar la foto trimestral aunque la aplicación estuviera parada ese día. La URL de la hoja es un secreto de configuración. Si la lectura falla se usa el último precio guardado, mostrando su fecha, y cualquier precio se puede corregir a mano.

**Tipos de cambio**: fichero diario de referencia del BCE, con su histórico. Se descargan las fechas que falten al arrancar y se guardan en `fx_rate`. Al registrar una operación en divisa se sugiere el cambio de su fecha (o el del último día hábil anterior).

## 6. Interfaz

| Ruta | Pantalla | Requisitos |
|---|---|---|
| `/` | Cuadro de cartera: totales, tabla por valor, previsión mensual, distribución | RF-19 a RF-24 |
| `/precios` | Estado de las fuentes de precios y cambios, y precio a mano | RF-43 a RF-46 |
| `/movimientos` | Listado de movimientos con acumulados, métricas y objetivos en cabecera | RF-07, RF-25, RF-26 |
| `/movimientos/nuevo` | Alta por tipo de operación, y alta rápida por lotes | RF-01 a RF-06 |
| `/valores` y `/valores/[ticker]` | Lista de valores en estudio y ficha de cada uno | RF-27 a RF-30 |
| `/dividendos` y `/dividendos/[id]` | Calendario por valor y cambios de dividendo por año; alta de un cambio (cobros por mes y año, en la fase 4) | RF-16 a RF-18, RF-38 |
| `/seleccion` | Listas ordenables, revisión mensual, texto para copiar | RF-31 a RF-36 |
| `/informes` | Top 50 y su evolución, evolución de la inversión, crecimiento de dividendos | RF-37 a RF-40 |
| `/conciliacion` | Saldo real de cada cuenta frente al calculado, e historial de conciliaciones | RF-12 |
| `/ajustes` | Cuentas y valores, objetivos anuales (`/ajustes/objetivos`), límites por *tier*, exportación de validación, copias y restauración | RF-47, RF-49 |

Un selector de cartera en la cabecera fija a cuál se refiere todo lo demás. La elección se recuerda en una *cookie* de un año. En el móvil, las tablas anchas se reducen a las columnas esenciales con detalle al tocar una fila, y el alta de operaciones es un formulario de una columna.

**Ventanas emergentes.** La ficha de un valor (desde el cuadro y desde Ajustes → Valores) y la edición de un movimiento (desde el listado) se abren encima de la pantalla en vez de cambiar de página. Componentes en `src/lib/components/`: `Dialog` (la ventana, con `<dialog>`), `SecurityDialog` y `OperationDialog`. Cargan los datos de la página de siempre con `preloadData` (con un parámetro `lectura` distinto en cada lectura, porque `preloadData` guarda lo que carga) y envían a sus acciones con `use:enhance`; al guardar cierran y recargan la pantalla de debajo. Los formularios están en componentes que comparten la página y la ventana (`SecurityForm`, `OperationEditor` con `OperationForm`). Con Ctrl, ⌘ o Mayúsculas el enlace abre la página completa.

**Preferencias de pantalla** en *cookies* de un año, para que el servidor pinte ya la vista elegida: `metricas` (métricas anuales abiertas o cerradas en movimientos), `acumulados` (columnas «Capital invertido» y «Ganancias año») y `meses` (columnas de meses del cuadro: ocultas, por acción o total).

## 7. Acceso y seguridad

- Inicio de sesión con Google (OpenID Connect). Solo se admite **una dirección de correo**, configurada como secreto; cualquier otra cuenta se rechaza.
- Sesión en *cookie* firmada, `HttpOnly`, `Secure`, `SameSite=Lax`, de 30 días.
- Todas las rutas exigen sesión, salvo el inicio de sesión y una comprobación de salud sin datos.
- La API para asistentes (`/api/v1`, [documentación](api.md)) es la excepción: no usa la sesión, sino un token propio (`API_TOKEN`) en la cabecera `Authorization`, comparado en tiempo constante. Sin token configurado está desactivada.
- HTTPS forzado; el certificado lo emite y renueva Fly con Let's Encrypt.
- Secretos (cliente de Google, clave de sesión, URL de la hoja de precios, credencial de la copia) como secretos de Fly, nunca en el repositorio.
- Cada máquina de Fly es una microVM Firecracker aislada, y las instantáneas de volumen se guardan cifradas.

## 8. Despliegue y operación

### 8.1 Fly.io

| Elemento | Configuración |
|---|---|
| Máquina | `shared-cpu-1x`, 512 MB, una sola, en París (`cdg`); Madrid ya no admite recursos nuevos |
| Volumen | 1 GB montado en `/data`, con retención de instantáneas de 30 días |
| Parada y arranque | `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0` |
| Dominio | `fly certs add invest.jdmuriel.com` y un registro CNAME de `invest` hacia el nombre `.fly.dev` de la aplicación |
| Red | IPv4 compartida e IPv6, sin IP dedicada |

El proxy de Fly comprueba cada pocos minutos si la máquina tiene tráfico y la para si no lo tiene; con la primera petición la vuelve a arrancar, en unos 2 segundos más el arranque de la aplicación. La página de entrada es ligera para que esa espera sea la única.

Se empieza con `"stop"`. El modo `"suspend"` reanuda en décimas de segundo, pero se deja para más adelante porque congela la memoria del proceso y hay que comprobar que la aplicación lo tolera.

**Coste previsto**, con los precios publicados por Fly:

| Concepto | Precio | Estimación mensual |
|---|---|---|
| Máquina de 512 MB encendida | 3,69 $/mes si no se parase nunca (algo más en Europa) | unos céntimos con 10 h de uso |
| Disco raíz con la máquina parada | 0,15 $/GB/mes | ≈ 0,10 $ |
| Volumen de 1 GB | 0,15 $/GB/mes | 0,15 $ |
| Instantáneas de volumen | 0,08 $/GB/mes, primeros 10 GB gratis | 0 |
| Certificado | primeros 10 gratis | 0 |
| IPv4 compartida e IPv6 | gratis | 0 |
| **Total** | | **≈ 0,30 $/mes**; menos de 5 $ aunque no se parase nunca |

### 8.2 Copias de seguridad

| Capa | Mecanismo | Retención |
|---|---|---|
| 1 | Instantánea diaria automática del volumen, en Fly | 30 días |
| 2 | Copia externa a Google Cloud Storage | 60 copias diarias y una mensual indefinida |
| 3 | Descarga manual desde `/ajustes` | la que decida el usuario |

La copia externa funciona así: tras cada cambio se marca la base de datos como pendiente; a los dos minutos sin más cambios, y también al recibir la señal de parada, la aplicación genera una copia consistente (`VACUUM INTO`), la comprime y la sube como `diaria/AAAA-MM-DD.db.gz` y `mensual/AAAA-MM.db.gz`, sobrescribiendo las del mismo día y mes. Una regla de ciclo de vida del *bucket* borra las diarias con más de 60 días. La aplicación usa una cuenta de servicio con permiso solo sobre ese *bucket*.

**Restaurar** es subir un fichero de copia desde `/ajustes`: la aplicación lo valida, guarda antes una copia de la base actual y lo sustituye. Es el mismo mecanismo que carga la migración inicial.

### 8.3 Entornos y despliegue

- **Local**: `npm run dev` con una base de datos de ejemplo generada con datos ficticios.
- **Producción**: `fly deploy` desde una acción de GitHub al fusionar en `main`, con un *token* de despliegue guardado como secreto del repositorio. Las migraciones de esquema se aplican al arrancar, tras una copia automática.

## 9. Migración y validación

1. **Importador** (`scripts/importar-legacy`): lee el Excel local y genera una base SQLite. No se ejecuta en producción ni sube el Excel a ningún sitio.
   - Valores, sectores, retenciones y calendario de dividendos desde `Control cartera`; fichas desde `Valores en estudio`.
   - Operaciones de los tres registros, con una tabla de normalización de tipos, monedas (`EU`, `UEUR`, vacías) y cuentas. Las filas que no se puedan interpretar se listan para revisarlas a mano; no se descartan en silencio.
   - Cambios de dividendo, histórico mensual de precios de la selección y fotos anuales del top 50.
2. **Validación automática**: el importador compara lo que calcula el motor con lo que dice la hoja, fila a fila, para saldo de cada cuenta, capital, resultado del año y acciones y coste de cada valor, y emite un informe de diferencias.
3. **Carga**: la base generada se sube a producción con la función de restaurar.
4. **Periodo en paralelo**: cada operación nueva se registra en ambos sitios y la exportación de validación (RF-49) se compara con la hoja.

**Privacidad**: el repositorio es público. El Excel, las bases de datos, las copias y los informes de diferencias están excluidos por `.gitignore`. Las pruebas usan una cartera inventada. Antes de cada *commit* del importador se revisa que no contenga importes ni cantidades reales, ni siquiera en comentarios o datos de prueba.

## 10. Cuestiones abiertas

### 10.1 Reconciliación con la hoja (resuelto)

Decisiones tomadas con el propietario y aplicadas en el importador:

- **FIFO en todo el histórico.** La hoja restaba del coste el importe de cada venta parcial; la aplicación da de baja los lotes más antiguos a su coste original.
- **Venta y recompra el mismo día = traspaso.** Las parejas de venta en un broker y compra en otro se migran como traspaso de valores: los lotes conservan fecha y coste, y solo se mueve el efectivo. Si la recompra es mayor que la venta, el exceso es una compra normal.
- **Fechas.** Las operaciones se ordenan por fecha; la hoja tiene algunas filas fuera de orden, que el informe de importación lista para revisarlas.

Diferencias esperadas frente a la hoja, que el informe de importación detalla (la lista completa, con erratas y fallos encontrados después, está en [incidencias-migracion.md](incidencias-migracion.md)):

- el coste de los valores traspasados difiere en la diferencia de precio entre la venta y la recompra, que la hoja sumaba al coste;
- el «capital invertido» del registro principal difiere en céntimos desde mediados de 2022, por una fila de la hoja a la que le falta la fórmula del resultado;
- el registro principal suma al capital invertido el resultado de cada año cerrado y los registros secundarios no. La aplicación calcula las dos magnitudes: capital aportado, y capital invertido con resultados capitalizados.

### 10.2 Otras

- **Región de Fly**: París (`cdg`). Madrid está retirada para recursos nuevos.
- **Capa gratuita de Google Cloud Storage**: según fuentes de terceros cubre 5 GB solo en regiones de EE. UU.; se confirma al crear el *bucket*. Fuera de ella, el coste de unos megas seguiría siendo de céntimos.
- **Precio de cierre trimestral en la hoja de precios**: hay que probar que `GOOGLEFINANCE` devuelve el histórico de todos los mercados usados.

## 11. Plan de la fase 1

| Paso | Entregable |
|---|---|
| 1 | Esqueleto del proyecto, esquema y migraciones, datos de ejemplo ficticios |
| 2 | Motor de cálculo con pruebas para cada tipo de operación |
| 3 | Importador del Excel con informe de diferencias |
| 4 | Listado de movimientos con acumulados y métricas anuales |
| 5 | Alta, edición y borrado de operaciones; alta rápida por lotes |
| 6 | Inicio de sesión, copias y restauración |
| 7 | Despliegue en Fly.io y carga de la migración |
| 8 | Exportación de validación con el formato de `Log` |
