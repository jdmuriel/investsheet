# Incidencias de la migración

Registro de todo lo que no coincide entre la hoja de cálculo y la aplicación, de los fallos encontrados al importar y de las erratas de la hoja. Sirve para que, durante el periodo en paralelo, una diferencia se pueda clasificar enseguida: **esperada** (está aquí), o **nueva** (hay que investigarla y anotarla).

Sin importes: el repositorio es público. El detalle con cifras está en los ficheros locales que no se versionan: `data/informe-importacion.md` (lo genera el importador) y la solapa «Diferencias» de la exportación de validación (Ajustes, o `npm run validar`).

## Estado de la migración (19 de noviembre de 2026)

- **Datos**: todo el histórico de las tres carteras está en producción (2.918 operaciones), con los datos de `Control cartera` y `Variación divs` (precios, tipos de cambio, calendario y cambios de dividendo) importados desde Ajustes. Los precios se leen ya de la hoja publicada y los cambios, del BCE.
- **Revisión de erratas de la hoja**: hecha. Corregidas en la aplicación las operaciones con el valor equivocado (H13), las monedas mal anotadas (H11 y H14) y dos fechas con el mes equivocado (H2). Están borrados los valores que eran erratas, y los demás tienen nombre y marca de activo o inactivo. Todas las correcciones conservan los importes importados.
- **Validación**: se valida solo la cartera principal contra `Log`. Las secundarias se llevan ya solo en la aplicación (H10).
- **Cuadro de cartera frente a `Control cartera`** (hoja del 19 de noviembre): coinciden el nº de acciones de todos los valores y el dividendo previsto. La diferencia de capital aportado es exactamente la apertura de 2014 (C5); las de coste son traspasos (C9); las de lo cobrado, criterio de la hoja y erratas de la copia a mano (C6).
- **Queda**: decidir qué cuenta como «cobrado» (P10), la exportación de validación de `Control cartera` (P7) y el periodo en paralelo de un mes.

Estado de cada entrada: **esperada** (la aplicación calcula distinto a propósito) · **corregida** (era un fallo, ya resuelto) · **pendiente** (falta una decisión o una acción, normalmente del propietario).

## 1. Diferencias de criterio (esperadas)

Son consecuencia de decisiones tomadas con el propietario. No hay que corregirlas: hay que reconocerlas al comparar.

| # | Qué difiere | Dónde se ve | Por qué |
|---|---|---|---|
| C1 | Coste de los valores con ventas parciales | Coste por valor y coste total del cuadro de cartera; columnas de coste de `Log` | La aplicación da de baja los lotes más antiguos a su coste original (FIFO). La hoja restaba del coste el importe de la venta. |
| C2 | Coste de los valores traspasados entre brokers | Lo mismo que C1 | Una venta y una recompra el mismo día se importan como traspaso: los lotes conservan fecha y coste. La hoja sumaba al coste la diferencia de precio entre la venta y la recompra. |
| C3 | Resultado de 2025 y, desde enero de 2026, capital invertido de la cartera principal | `Log`: ganancias del año y capital invertido; métricas de 2025 | Las primas de las dos opciones de 2025 son renta del año (negativa si se pagó). La hoja las anotaba como compra. Migración 3. |
| C4 | Capital invertido de las carteras secundarias | `Log` de las carteras secundarias | La hoja principal suma al capital invertido el resultado de cada año cerrado y las secundarias no. La aplicación calcula las dos magnitudes. **Decidido**: todas muestran el capital con el resultado de los años cerrados; la exportación de validación de las secundarias sigue imitando a la hoja, pero ya no se validan. |
| C5 | Capital aportado del cuadro de cartera, y con él el resultado total | Cuadro de cartera frente a «Capital aportado» de `Control cartera` | La aplicación cuenta como aportación la apertura de 2014; la hoja no la anota como tal. **Comprobado el 2026-11-19: la diferencia es exactamente el importe de la apertura.** |
| C6 | Dividendos cobrados históricos por valor, y el «% recuperado» | Cuadro de cartera frente a `Control cartera` | La aplicación suma solo los dividendos del registro. La hoja los copia a mano y en algunos valores suma además devoluciones de prima y ventas de derechos: cuadra exactamente con eso en `ACS`, `IBE`, `VIS` y `SAN` (en `SAN`, solo la devolución de prima y la venta de derechos con retención), y casi en `MRL`. En `SHELL` la hoja suma parte de lo cobrado de `RDSA` y `RDSB`. Quedan diferencias de céntimos o de un cobro en `MO`, `SBUX`, `XOM` y `NTGY`, erratas de la copia a mano. Revisado el 2026-11-19 (P10). |
| C7 | Fracción de año transcurrida de los objetivos | Listado de movimientos frente a la cabecera de `Log` | La aplicación la mide por días; la hoja, por meses completos. |
| C9 | Coste de `CVS`, `DIS`, `ENG`, `MMM`, `PFE`, `SPG`, `UNA` y `SHELL` | Cuadro de cartera frente a `Control cartera` | Son los traspasos de C2. En `SHELL` es la venta de `RDSA` en Londres y su recompra en Ámsterdam de 2020: la aplicación conserva el coste original y la hoja lo rebajó con la pérdida de la venta. El nº de acciones coincide en todos los valores. Revisado el 2026-11-19. |
| C10 | «Por reinvertir» (cobrado desde la última compra) | Cuadro de cartera frente a la fila «Importe bruto cobrado desde última compra» | Difiere en muchos valores: la hoja lo lleva a mano y el criterio está sin definir (RF-22 en el plan). |
| C8 | Reinicio de las ganancias del año | `Log`, filas del 31 de diciembre y el 1 de enero | La hoja las reinicia en filas elegidas a mano; la aplicación, siempre el 1 de enero. La comparación admite las dos cosas en esas fechas. |

## 2. Erratas y rarezas de la hoja

La aplicación las ha absorbido o las señala; algunas conviene corregirlas también en la hoja mientras dure el periodo en paralelo.

| # | Incidencia | Tratamiento | Estado |
|---|---|---|---|
| H1 | Una fila de `Log` de mediados de 2022 no tiene la fórmula del resultado: el capital invertido de la hoja se desvía unos céntimos desde entonces. | La aplicación da el valor correcto; la diferencia se arrastra y aparece como «diferencia vigente». | esperada |
| H2 | Filas con la fecha fuera de orden: 31 en la cartera principal, 16 y 2 en las secundarias. | La aplicación ordena por fecha; los acumulados solo se comparan en las fechas en que la hoja está ordenada. El informe de importación las lista. Revisadas: son anotaciones hechas con unos días de retraso, salvo dos filas de la principal fechadas en marzo de 2021 que eran de mayo (prima de asistencia de `VIS` y devolución de prima de `MRL`). Su fecha se corrigió en la aplicación con el visto bueno del propietario, y él la ha corregido en la hoja. | corregida |
| H3 | Monedas mal tecleadas (`EU`, `UEUR`, `IBUSD`) y filas sin moneda. | Se normalizan con `scripts/legacy-config.json`. | corregida |
| H4 | Valores de Londres en peniques (`GBX`): precio, dividendo previsto y tipo de cambio. | Se pasan a libras al leerlos; dentro todo va en `GBP`. | corregida |
| H5 | Ticker `KHZ` por `KHC`; una fecha de un dividendo de `GIS`. | Alias y corrección puntual en `scripts/legacy-config.json`. | corregida |
| H6 | Cinco compras con el ticker mal tecleado: `REE` (tres, por `RED`), `HCP` (por `PEAK`) y `3M` (por `MMM`). La hoja las sumó en la columna del valor bueno. | Se importan a nombre del valor bueno (véase F1). Los valores `REE`, `HCP` y `3M` quedan sin compras, pero sí con dividendos (véase H13). | corregida; falta H13 |
| H7 | Una compra de octubre de 2026 anotada con ticker `AMS` que no entra en ninguna columna: la hoja no cuenta esas acciones en ningún valor. | Es Amadeus (`BME:AMS`). La hoja ya tiene su columna y la aplicación, su precio. | corregida |
| H8 | El valor `MICC`, recibido y vendido en diciembre de 2025, no tiene columna propia. | Se da de alta a coste cero y se vende; el ajuste de coste va al valor del que procede. | esperada |
| H9 | Dos columnas para un mismo valor que cambió de mercado (dos de `SHELL`). | Manda la que tiene posición. | corregida |
| H10 | Las solapas de las carteras secundarias no tienen movimientos de 2026 y los rótulos de años de su cabecera están desfasados. | Los objetivos de la cabecera se anotan en el año del último movimiento del libro, no en el del rótulo. Decidido: las secundarias se llevan solo en la aplicación y no se validan. | esperada |
| H11 | Tres cambios de dividendo de `Variación divs` con la moneda mal puesta: `O` y `GIS` en euros con cambio 1 (son dólares) y `SAN` en dólares (son euros). La hoja calculó con eso su efecto en euros. Los dos de `SHELL` en dólares son correctos: Shell declara el dividendo en dólares. | Se importan tal cual. Corregidos en la aplicación el 2026-11-19 por la API (`PATCH /api/v1/cambios-dividendo/{id}`), con el cambio del BCE de su fecha. | corregida en la aplicación |
| H12 | Tres totales numéricos de la fila de tickers de `Control cartera` se tomaron por valores. | El importador solo acepta textos con forma de ticker; la migración 5 los borró. | corregida |
| H13 | Unas 40 filas de `Log`, casi todas dividendos, con el ticker de otro valor o mal tecleado (`REE`, `HCP`, `3M`, `GOOG`, `GBP`, `BME;ELE`, `LON.AV`, o el ticker de la fila de al lado). En los dividendos la hoja no usa esa celda; la aplicación sí, para atribuir el dividendo a un valor. También dos compras (`JNJ` por `BATS`, `AMS` por `PM`) cuyas acciones sí entraron en la columna buena. | Atribuye mal los dividendos cobrados por valor (parte de C6) y deja valores fantasma en el mantenimiento. Al editar una de esas compras, el formulario regeneraría la posición en el valor equivocado. Corregidas en la aplicación el 2026-11-19 (41 operaciones, por la API con `keepEffects`, sin tocar importes) y borrados los valores `3M`, `BME;ELE`, `GBP`, `GOOG`, `LON.AV`, `REE` y `HCP`. Después, seis dividendos más entre clases hermanas (`BEP`/`BEPC`, `BIP`/`BIPC`, `RDSA`/`RDSB`), con el ticker que dio el propietario; él los ha corregido también en la hoja, igual que las 41 primeras. | corregida |
| H14 | Siete dividendos de la principal con la moneda mal anotada: seis de `AV`, `BATS` y `RIO` en dólares, que se cobran en libras (el cambio aplicado era el de la libra, así que los euros están bien), y uno de `MAP` en dólares con cambio 1. Los de `RDSB` en libras y `RDSA` en euros son correctos: así pagaba Shell cada clase. | Corregida en la aplicación la moneda de las siete, sin tocar importes ni cambio (`keepEffects` con `currency`). | corregida en la aplicación |
| H15 | `BMY` y `GOOGL`, que solo están en las carteras secundarias, no tenían columna en `Control cartera`: sin moneda, retenciones, precio ni calendario. | Puestos moneda (`USD`) y retenciones (como los demás valores de EE. UU.) por la API. Falta añadirlos a la hoja de precios y, si se quiere, su calendario de dividendos. | pendiente (P9) |

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
| P1 | ~~Revisar las filas con fecha fuera de orden (H2).~~ | Hecho |
| P2 | ~~Valor de la compra anotada como `AMS` (H7).~~ Es Amadeus. | Hecho |
| P3 | ~~Marcar como inactivos `REE`, `HCP` y `3M`.~~ Borrados tras corregir H13. | Hecho |
| P4 | ~~Capital invertido de las secundarias (C4).~~ Decidido: como la principal. | — |
| P5 | ~~Poner al día las solapas de las secundarias (H10).~~ Decidido: se llevan solo en la aplicación y no se validan. | — |
| P6 | ~~Comprobar la diferencia de capital aportado (C5) y revisar valor a valor el cuadro de cartera (C6, C9, C10).~~ Hecho con la hoja del 2026-11-19. | Hecho |
| P7 | Exportación de validación con el formato de `Control cartera` (tarea 2.7): hoy el cuadro solo se ha comparado en sus totales. | Sesión de trabajo |
| P8 | ~~Corregir en la hoja las filas de H13 (y H2, H11, H14).~~ | Hecho |
| P10 | Decidir si «Cobrado» y el «% recuperado» del cuadro incluyen las devoluciones de prima y las ventas de derechos, como hace la hoja en algunos valores (C6). | Propietario |
| P9 | Añadir `BMY` y `GOOGL` a la hoja de precios (H15) y, si se quiere, darles calendario de dividendos. | Propietario |

## Lo que sí coincide

Con la hoja de noviembre de 2026:

- **Efectivo**: el saldo final de todas las cuentas de las tres carteras.
- **Acciones**: las de todos los valores con columna, salvo los afectados por C1 y C2 en filas intermedias.
- **Cuadro de cartera**: valor de mercado, liquidez, PADI bruto y neto y tipo de retención efectivo.
- **Recorrido**: el estado final es el mismo recorriendo las operaciones por fecha que en el orden de la hoja.
