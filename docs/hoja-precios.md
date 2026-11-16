# Hoja de precios

La aplicación no consulta ninguna fuente de precios de pago: lee una hoja de cálculo de Google que usa `GOOGLEFINANCE`, publicada como CSV. Esta página explica cómo montarla. Es una hoja nueva y pequeña, independiente de la hoja de inversión.

## 1. Crear la hoja

Una hoja de Google con una pestaña llamada `actual` y una fila por valor:

| | A | B | C | D |
|---|---|---|---|---|
| 1 | Ticker | Precio | Moneda | Fecha |
| 2 | `BME:ACME` | `=GOOGLEFINANCE(A2;"price")` | `=GOOGLEFINANCE(A2;"currency")` | `=GOOGLEFINANCE(A2;"tradetime")` |
| 3 | … | (copiar hacia abajo) | | |

- **Columna A**: el ticker con el que Google conoce el valor. Debe coincidir con el «ticker de precios» que tiene el valor en la aplicación (Ajustes → Valores); la pantalla Precios los lista todos. Si un valor no tiene ticker de precios, vale su ticker a secas.
- **Columna C**: se puede escribir a mano (`EUR`, `USD`, `GBP`) si la fórmula no devuelve nada. Si se deja vacía se toma la moneda del valor.
- **Columna D**: es opcional. Sin fecha, el precio se anota en el día de la lectura.
- Los valores de Londres cotizan en peniques y Google lo indica con `GBX`: la aplicación los pasa a libras sola. No hay que dividir entre 100 en la hoja.
- Las filas con error (`#N/A`) se saltan y el valor conserva su último precio.
- El orden de las filas y las columnas a la derecha de la D no importan. La fila de títulos es opcional.

## 2. Publicarla

1. Archivo → Compartir → **Publicar en la web**.
2. Elegir la pestaña `actual` y el formato **Valores separados por comas (.csv)**.
3. Publicar y copiar la dirección que da (termina en `output=csv`).

Cualquiera que tenga esa dirección puede leer la hoja, pero solo contiene tickers y precios públicos: ni acciones ni importes.

## 3. Dársela a la aplicación

Guardar la dirección como secreto en Fly:

```
fly secrets set PRICES_CSV_URL='https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&single=true&output=csv'
```

En desarrollo basta con definir la misma variable de entorno antes de `npm run dev`.

## 4. Comprobar

En la pantalla **Precios** (enlazada desde el cuadro de cartera y desde Ajustes), el botón «Leer ahora» fuerza una lectura y muestra el resultado: cuándo se leyó, o el error si no se pudo. Cada valor muestra su último precio, la fecha y el origen.

## Cómo se comporta

- Los precios se leen solos al abrir el cuadro de cartera cuando la última lectura tiene más de una hora.
- Si la lectura falla se usan los últimos precios guardados, con su fecha a la vista.
- Un precio tecleado a mano en la pantalla Precios manda durante ese día; al día siguiente vuelve a mandar la hoja.
- Google refresca `GOOGLEFINANCE` con unos 20 minutos de retraso, y la versión publicada tarda unos minutos más en actualizarse.

## Tipos de cambio

No dependen de esta hoja: se descargan del fichero diario de referencia del Banco Central Europeo, con su histórico, y se usan para pasar a euros precios, dividendos y saldos, y para sugerir el cambio al anotar una operación en divisa.
