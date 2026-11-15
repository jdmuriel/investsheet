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
| Base de datos | SQLite (`better-sqlite3`) con Drizzle para esquema y migraciones | Un fichero; copia y restauración triviales; sobra para un usuario |
| Decimales | `decimal.js` | Evitar errores de coma flotante en importes, precios y cambios |
| Hoja de cálculo | ExcelJS | Importar la hoja antigua y generar la exportación de validación |
| Gráficos | Chart.js | Suficiente para barras, líneas y sectores |
| Pruebas | Vitest (motor de cálculo) y Playwright (flujos principales) | |
| Contenedor | Imagen Node *slim* de varias etapas | Imagen pequeña: se paga por GB mientras la máquina está parada |

La aplicación es instalable (manifiesto y *service worker* mínimo) pero **no funciona sin conexión**: sin servidor no hay datos.

## 3. Modelo de datos

Importes en **céntimos enteros** de su moneda. Cantidades, precios y tipos de cambio como **texto decimal** (hay precios con 5 decimales, cambios con 9 y factores de *split* fraccionarios). Fechas como `AAAA-MM-DD`.

```
portfolio(id, name)
account(id, portfolio_id, broker, name, currency, sort_order, closed)
security(id, ticker, price_ticker, name, market, country, currency, dividend_currency,
         sector, supersector, zone, tier, wht_source_pct, wht_dest_pct, reinvest, active)
security_note(security_id, eps, target_price, target_date, target_reason, thesis,
              links_json, notes)
security_review(id, security_id, year, text)

operation(id, portfolio_id, date, seq, type, account_id, security_id,
          quantity, price, currency, fx_rate,
          gross, wht_source, wht_dest, fees,          -- en la moneda de la operación
          gross_eur, tax_eur, fees_eur,               -- contravalor guardado, editable
          capital_in_eur, capital_out_eur,
          cash_delta,                                 -- efecto en la cuenta, en su moneda
          counter_account_id, counter_cash_delta,     -- traspasos y cambios de divisa
          cost_delta_eur, reduced_cost_delta_eur,     -- efecto en el coste del valor
          description, notes, source, created_at, updated_at)

dividend_schedule(id, security_id, valid_from, month, amount_per_share, currency)
dividend_change(id, security_id, date, annual_before, annual_after, shares_at_date,
                fx_rate, url, note)

price(security_id, date, close, source, fetched_at)
fx_rate(currency, date, rate)                         -- unidades de divisa por euro
goal(portfolio_id, year, metric, amount_eur)

selection_review(id, date, closed)
selection_item(review_id, security_id, list, position, price, note)
selection_decision(id, portfolio_id, date, proposals, choice)

snapshot(id, portfolio_id, date, kind)                -- trimestral, anual o manual
snapshot_item(snapshot_id, security_id, shares, cost_eur, reduced_cost_eur,
              price, fx_rate, market_value_eur, forecast_dividend_eur)

setting(key, value)                                   -- límites por tier, umbrales
audit_log(id, at, entity, entity_id, action, before_json, after_json)
```

Puntos de diseño:

- **Orden**: las operaciones se ordenan por `(date, seq)`. `seq` se asigna al final del día al crearla y se puede cambiar a mano; por eso se pueden introducir en cualquier orden.
- **Efectos explícitos**: cada operación guarda su efecto en efectivo y en coste (`cash_delta`, `cost_delta_eur`…). El formulario los calcula según el tipo, pero quedan guardados y son editables, lo que permite el ajuste de céntimos y los casos raros sin reglas especiales.
- **Contravalor en euros guardado**, no recalculado: es el que se usó al registrar la operación.
- **Calendario de dividendos versionado** por `valid_from`: cada cambio de dividendo crea una versión nueva y conserva las anteriores, de modo que el PADI de una fecha pasada se puede reconstruir.
- **Registro de auditoría**: cada alta, edición o borrado guarda el antes y el después, para poder deshacer un error.

## 4. Motor de cálculo

Un módulo sin dependencias de base de datos ni de red: recibe la lista ordenada de operaciones de una cartera y devuelve, para cada operación, el estado acumulado tras ella.

```
estado = {
  efectivo por cuenta,
  capital aportado,
  resultado acumulado del año,
  por valor: { acciones, coste, coste reducido, dividendos brutos cobrados,
               cobrado desde la última compra }
}
```

De ese recorrido salen el listado de movimientos (RF-07), el estado a cualquier fecha (RF-10 a RF-14), las métricas anuales (RF-25) y la base del cuadro de cartera. Con unas 5.000 operaciones el recorrido completo tarda milisegundos, así que se hace en cada petición y se guarda en memoria mientras no cambien los datos.

### 4.1 Efecto de cada tipo de operación

| Tipo | Efectivo | Acciones | Coste | Coste reducido | Resultado |
|---|---|---|---|---|---|
| Compra | − importe − gastos | + cantidad | + importe | + importe | − gastos |
| Venta | + importe − gastos | − cantidad | ver §10.1 | ver §10.1 | − gastos |
| Dividendo, interés, promoción | + bruto − retenciones − gastos | | | | + neto |
| Devolución de prima | + importe | | | − importe | + importe |
| Aportación / retirada | ± importe | | | | (capital ±) |
| Traspaso | − en origen, + en destino | | | | |
| Cambio de divisa | − en una cuenta, + en otra | | | | − gastos |
| Gasto o comisión | − importe | | | | − importe |
| Compra de derechos | − importe − gastos | | + importe | + importe | − gastos |
| Venta de derechos | + bruto − retención − gastos | | | − bruto | + neto |
| Conversión de derechos, ampliación liberada | | + cantidad | | | |
| *Split* / contrasplit | | × factor | | | |
| *Spin-off* | + picos, si los hay | + en el valor nuevo | reparto manual | reparto manual | + picos |
| Conversión de ticker | | pasa al valor nuevo | pasa al valor nuevo | pasa al valor nuevo | |
| Opciones (venta de *put*, compra de *call*) | ± prima − gastos | | | | − gastos |
| Pérdidas / compensación de fondos | ± importe | | | | ± importe |

Esta tabla reproduce lo observado en la hoja. La migración la valida: si el motor no da los mismos saldos y posiciones que la hoja a cierre de cada año, la regla está mal.

### 4.2 Cálculos con precios

El cuadro de cartera combina el estado del motor con el último precio, el tipo de cambio y el calendario de dividendos vigente, según las fórmulas del §6 de la especificación. No se guarda nada; solo las fotos (`snapshot`) congelan valores.

## 5. Precios y tipos de cambio

**Precios**: una hoja de Google con una fila por valor y dos pestañas publicadas como CSV:

| Pestaña | Columnas | Fórmula |
|---|---|---|
| `actual` | ticker, precio, moneda, fecha y hora | `GOOGLEFINANCE(ticker; "price")` |
| `cierre` | ticker, fecha de cierre, precio | precio de cierre en el último fin de trimestre, con la fecha calculada en la propia hoja |

La aplicación lee `actual` cuando el último precio guardado tiene más de 60 minutos y alguien abre una vista que lo necesita. La pestaña `cierre` permite generar la foto trimestral aunque la aplicación estuviera parada ese día. La URL de la hoja es un secreto de configuración. Si la lectura falla se usa el último precio guardado, mostrando su fecha, y cualquier precio se puede corregir a mano.

**Tipos de cambio**: fichero diario de referencia del BCE, con su histórico. Se descargan las fechas que falten al arrancar y se guardan en `fx_rate`. Al registrar una operación en divisa se sugiere el cambio de su fecha (o el del último día hábil anterior).

## 6. Interfaz

| Ruta | Pantalla | Requisitos |
|---|---|---|
| `/` | Cuadro de cartera: totales, tabla por valor, previsión mensual | RF-19 a RF-24 |
| `/movimientos` | Listado de movimientos con acumulados, métricas y objetivos en cabecera | RF-07, RF-25, RF-26 |
| `/movimientos/nuevo` | Alta por tipo de operación, y alta rápida por lotes | RF-01 a RF-06 |
| `/valores` y `/valores/[ticker]` | Lista de valores en estudio y ficha de cada uno | RF-27 a RF-30 |
| `/dividendos` | Calendario por valor, cambios de dividendo, cobros por mes y año | RF-16 a RF-18, RF-38 |
| `/seleccion` | Listas ordenables, revisión mensual, texto para copiar | RF-31 a RF-36 |
| `/informes` | Top 50 y su evolución, evolución de la inversión, crecimiento de dividendos | RF-37 a RF-40 |
| `/ajustes` | Cuentas, objetivos, límites por *tier*, exportación, copias y restauración | RF-12, RF-47, RF-49 |

Un selector de cartera en la cabecera fija a cuál se refiere todo lo demás. En el móvil, las tablas anchas se reducen a las columnas esenciales con detalle al tocar una fila, y el alta de operaciones es un formulario de una columna.

## 7. Acceso y seguridad

- Inicio de sesión con Google (OpenID Connect). Solo se admite **una dirección de correo**, configurada como secreto; cualquier otra cuenta se rechaza.
- Sesión en *cookie* firmada, `HttpOnly`, `Secure`, `SameSite=Lax`, de 30 días.
- Todas las rutas exigen sesión, salvo el inicio de sesión y una comprobación de salud sin datos.
- HTTPS forzado; el certificado lo emite y renueva Fly con Let's Encrypt.
- Secretos (cliente de Google, clave de sesión, URL de la hoja de precios, credencial de la copia) como secretos de Fly, nunca en el repositorio.
- Cada máquina de Fly es una microVM Firecracker aislada, y las instantáneas de volumen se guardan cifradas.

## 8. Despliegue y operación

### 8.1 Fly.io

| Elemento | Configuración |
|---|---|
| Máquina | `shared-cpu-1x`, 512 MB, una sola, en una región europea |
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

### 10.1 Coste en las ventas

Al revisar las fórmulas, la hoja **no descuenta coste medio**, en contra de lo que se dijo al cerrar la especificación:

- en una venta parcial resta del coste del valor el **importe obtenido en la venta**;
- en una venta total pone el coste a cero a mano;
- el resultado de la operación solo recoge los gastos: la plusvalía o minusvalía no entra en las ganancias del año.

Opciones:

| Opción | Coste tras una venta parcial | Efecto |
|---|---|---|
| A. Como la hoja | coste − importe de la venta | Valida contra la hoja sin diferencias; el precio medio de lo que queda baja (o sube) según el precio de venta |
| B. Coste medio | coste × acciones restantes / acciones previas | Precio medio estable; diferirá de la hoja en los pocos valores con ventas parciales |

**Propuesta**: aplicar A a las operaciones migradas, para que la validación sea exacta, y decidir cuál se usa para las ventas futuras. Como el efecto en el coste se guarda en cada operación (§3), ambas pueden convivir.

### 10.2 Otras

- **Región de Fly**: Madrid si está disponible para máquinas nuevas; si no, París o Fráncfort. Se confirma al crear la aplicación.
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
