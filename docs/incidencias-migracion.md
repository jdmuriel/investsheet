# Incidencias de la migración

Registro de todo lo que no coincide entre la hoja de cálculo y la aplicación, de los fallos encontrados al importar y de las erratas de la hoja. Sirve para que, durante el periodo en paralelo, una diferencia se pueda clasificar enseguida: **esperada** (está aquí), o **nueva** (hay que investigarla y anotarla).

Sin importes: el repositorio es público. El detalle con cifras está en los ficheros locales que no se versionan: `data/informe-importacion.md` (lo genera el importador) y la solapa «Diferencias» de la exportación de validación (Ajustes, o `npm run validar`).

Estado de cada entrada: **esperada** (la aplicación calcula distinto a propósito) · **corregida** (era un fallo, ya resuelto) · **pendiente** (falta una decisión o una acción, normalmente del propietario).

## 1. Diferencias de criterio (esperadas)

Son consecuencia de decisiones tomadas con el propietario. No hay que corregirlas: hay que reconocerlas al comparar.

| # | Qué difiere | Dónde se ve | Por qué |
|---|---|---|---|
| C1 | Coste de los valores con ventas parciales | Coste por valor y coste total del cuadro de cartera; columnas de coste de `Log` | La aplicación da de baja los lotes más antiguos a su coste original (FIFO). La hoja restaba del coste el importe de la venta. |
| C2 | Coste de los valores traspasados entre brokers | Lo mismo que C1 | Una venta y una recompra el mismo día se importan como traspaso: los lotes conservan fecha y coste. La hoja sumaba al coste la diferencia de precio entre la venta y la recompra. |
| C3 | Resultado de 2025 y, desde enero de 2026, capital invertido de la cartera principal | `Log`: ganancias del año y capital invertido; métricas de 2025 | Las primas de las dos opciones de 2025 son renta del año (negativa si se pagó). La hoja las anotaba como compra. Migración 3. |
| C4 | Capital invertido de las carteras secundarias | `Log` de las carteras secundarias | La hoja principal suma al capital invertido el resultado de cada año cerrado y las secundarias no. La aplicación calcula las dos magnitudes. Pendiente decidir cuál se muestra en las secundarias (P4). |
| C5 | Capital aportado del cuadro de cartera, y con él el resultado total | Cuadro de cartera frente a «Capital aportado» de `Control cartera` | La aplicación cuenta como aportación la apertura de 2014; la hoja no la anota como tal. **No está comprobado que explique toda la diferencia** (P6). |
| C6 | Dividendos cobrados históricos por valor, y el «% recuperado» | Cuadro de cartera frente a `Control cartera` | La hoja los copia a mano desde `Log`, mes a mes; la aplicación los suma del registro. No se ha revisado valor a valor de dónde sale cada diferencia. |
| C7 | Fracción de año transcurrida de los objetivos | Listado de movimientos frente a la cabecera de `Log` | La aplicación la mide por días; la hoja, por meses completos. |
| C8 | Reinicio de las ganancias del año | `Log`, filas del 31 de diciembre y el 1 de enero | La hoja las reinicia en filas elegidas a mano; la aplicación, siempre el 1 de enero. La comparación admite las dos cosas en esas fechas. |

## 2. Erratas y rarezas de la hoja

La aplicación las ha absorbido o las señala; algunas conviene corregirlas también en la hoja mientras dure el periodo en paralelo.

| # | Incidencia | Tratamiento | Estado |
|---|---|---|---|
| H1 | Una fila de `Log` de mediados de 2022 no tiene la fórmula del resultado: el capital invertido de la hoja se desvía unos céntimos desde entonces. | La aplicación da el valor correcto; la diferencia se arrastra y aparece como «diferencia vigente». | esperada |
| H2 | Filas con la fecha fuera de orden: 31 en la cartera principal, 16 y 2 en las secundarias. | La aplicación ordena por fecha; los acumulados solo se comparan en las fechas en que la hoja está ordenada. El informe de importación las lista. | pendiente (P1) |
| H3 | Monedas mal tecleadas (`EU`, `UEUR`, `IBUSD`) y filas sin moneda. | Se normalizan con `scripts/legacy-config.json`. | corregida |
| H4 | Valores de Londres en peniques (`GBX`): precio, dividendo previsto y tipo de cambio. | Se pasan a libras al leerlos; dentro todo va en `GBP`. | corregida |
| H5 | Ticker `KHZ` por `KHC`; una fecha de un dividendo de `GIS`. | Alias y corrección puntual en `scripts/legacy-config.json`. | corregida |
| H6 | Cinco compras con el ticker mal tecleado: `REE` (tres, por `RED`), `HCP` (por `PEAK`) y `3M` (por `MMM`). La hoja las sumó en la columna del valor bueno. | Se importan a nombre del valor bueno (véase F1). Los valores `REE`, `HCP` y `3M` quedan sin movimientos. | corregida; falta marcarlos inactivos (P3) |
| H7 | Una compra de octubre de 2026 anotada con ticker `AMS` que no entra en ninguna columna: la hoja no cuenta esas acciones en ningún valor. | En la aplicación aparece como un valor aparte, `AMS`, sin precio ni calendario. | pendiente (P2) |
| H8 | El valor `MICC`, recibido y vendido en diciembre de 2025, no tiene columna propia. | Se da de alta a coste cero y se vende; el ajuste de coste va al valor del que procede. | esperada |
| H9 | Dos columnas para un mismo valor que cambió de mercado (dos de `SHELL`). | Manda la que tiene posición. | corregida |
| H10 | Las solapas de las carteras secundarias no tienen movimientos de 2026 y los rótulos de años de su cabecera están desfasados. | Los objetivos de la cabecera se anotan en el año del último movimiento del libro, no en el del rótulo. | pendiente (P5) |
| H11 | Algún cambio de dividendo de `Variación divs` tiene la moneda mal puesta (visto en `SAN`, anotado en dólares). | Se importa tal cual; solo afecta al símbolo y al cambio aplicado a ese cambio. | pendiente: revisar la lista de cambios |
| H12 | Tres totales numéricos de la fila de tickers de `Control cartera` se tomaron por valores. | El importador solo acepta textos con forma de ticker; la migración 5 los borró. | corregida |

## 3. Fallos de importación encontrados

| # | Fallo | Efecto | Corrección |
|---|---|---|---|
| F1 | Las cinco compras de H6 se importaron **dos veces**: una en el valor en cuya columna las anotó la hoja y otra a nombre del ticker tecleado. | Posiciones fantasma en `REE`, `HCP` y `3M`, que inflaban el coste total y el número de valores. No afectaba al efectivo ni al listado de movimientos, y la exportación de validación no lo veía porque esos tickers no tienen columna. Estuvo en producción desde la carga inicial. | Migración 7 (borra el lote sobrante y la operación pasa a citar el valor bueno) e importador. Comprobado que una base migrada queda igual que una reimportada. |
| F2 | La prima de las opciones se importó como compra. | Véase C3. | Migración 3 e importador. |
| F3 | Los valores numéricos de H12. | Tres valores falsos en el mantenimiento. | Migración 5 e importador. |

## 4. Lo que no se ha podido importar o reconstruir

- **Calendario de dividendos anterior**: la hoja solo guarda el vigente. Entra en vigor en la fecha de los precios de la hoja; el PADI de fechas anteriores no se puede reconstruir, solo la lista de cambios.
- **Fecha de los precios de `Control cartera`**: la hoja no la guarda. El importador usa la del último movimiento del libro; al importar desde Ajustes se pregunta.
- **Zona y *tier* de cada valor**: están en `Selección`, que se importará en la fase 3. Hasta entonces esos filtros del cuadro no aparecen.
- **Nombre de cada valor**: `Control cartera` solo tiene el ticker.
- **Aún sin importar** (fases 3 y 4): `Valores en estudio`, el histórico mensual de `Selección` y las fotos anuales del top 50.

## 5. Pendiente de decidir o de hacer

| # | Asunto | Quién |
|---|---|---|
| P1 | Revisar las filas con fecha fuera de orden (H2) en el informe de importación. | Propietario |
| P2 | Decidir a qué valor corresponde la compra anotada como `AMS` (H7) y corregirla en la aplicación y en la hoja. | Propietario |
| P3 | Marcar como inactivos `REE`, `HCP` y `3M` en Ajustes → Valores. | Propietario |
| P4 | Decidir si las carteras secundarias muestran el capital invertido con el resultado de los años cerrados (C4). | Propietario |
| P5 | Poner al día las solapas de las carteras secundarias antes del periodo en paralelo, si se quieren validar (H10). | Propietario |
| P6 | Comprobar si la apertura de 2014 explica toda la diferencia de capital aportado (C5), y revisar valor a valor los dividendos cobrados históricos (C6). | Sesión de trabajo, con los datos reales |
| P7 | Exportación de validación con el formato de `Control cartera` (tarea 2.7): hoy el cuadro solo se ha comparado en sus totales. | Sesión de trabajo |

## Lo que sí coincide

Con la hoja de noviembre de 2026:

- **Efectivo**: el saldo final de todas las cuentas de las tres carteras.
- **Acciones**: las de todos los valores con columna, salvo los afectados por C1 y C2 en filas intermedias.
- **Cuadro de cartera**: valor de mercado, liquidez, PADI bruto y neto y tipo de retención efectivo.
- **Recorrido**: el estado final es el mismo recorriendo las operaciones por fecha que en el orden de la hoja.
