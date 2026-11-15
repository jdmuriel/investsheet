# Descripción de la hoja actual

Análisis del libro `legacy/Inversión.xlsx` (exportado de Google Sheets, no versionado). Este documento describe **qué hace hoy la hoja y cómo lo calcula**, como base para la [especificación](especificacion.md) de la herramienta que la sustituye. No contiene importes ni posiciones reales.

## 1. Visión general

La hoja lleva una cartera de acciones orientada a dividendos (estrategia *buy & hold* con reinversión), en tres carteras independientes: la propia y una por cada hijo.

Todo parte de un **registro de operaciones** (`Log`). El resto de solapas son, o deberían ser, vistas derivadas de él más unos pocos datos mantenidos a mano (dividendos previstos, precio objetivo, tesis, orden de la selección).

| Solapa | Papel | Naturaleza |
|---|---|---|
| `Log` | Registro de operaciones de la cartera propia, saldos de efectivo, coste y nº de acciones por valor, métricas anuales y objetivos | Entrada de datos + cálculo |
| Log de cada hijo (2 solapas) | Lo mismo para las cuentas de los hijos, con fórmulas en vez de columnas arrastradas | Entrada de datos + cálculo |
| `Control cartera` | Cuadro por valor: posición, coste, valor de mercado, P/G, dividendos previstos (PADI), yields, histórico de dividendos cobrados | Vista + datos manuales |
| `Valores en estudio` | Ficha de cada valor en cartera o en seguimiento: dividendo, BPA, PER, precio objetivo, tesis, enlaces | Datos manuales + precio |
| `Selección` | Listas ordenadas a mano cada mes para decidir qué comprar, con histórico mensual de precios | Datos manuales + vista |
| `Variación divs` | Registro de subidas y bajadas de dividendo y su efecto en euros anuales | Entrada de datos |
| `Análisis cartera` | Ranking de valores por valor de mercado y por dividendo previsto | Vista |
| `Evolución top 50` | Foto anual del ranking anterior, pegada a mano como valores | Histórico manual |
| `Evolución div. mes` | Dividendos netos por mes y año, con gráficos | Vista |
| `Crecimiento div` | Descomposición anual del crecimiento de dividendos: orgánico frente a nuevas compras | Vista con copia manual anual |
| `IRPF` | Notas y tablas de apoyo para la declaración de cada año | Manual |

## 2. `Log`: registro de operaciones

### 2.1 Columnas de entrada

Cada fila es una operación con: fecha, descripción libre, tipo de operación, ticker, cantidad, precio unitario, moneda, tipo de cambio, cuenta, importe en moneda local, impuestos en moneda local, gastos en moneda local, y los equivalentes en euros (ingresos brutos, impuestos, gastos), aumento o retirada de capital e importe de compra sin comisiones.

- El **tipo de cambio** se expresa como unidades de moneda extranjera por euro (EURUSD); el importe en euros es el local dividido por el cambio.
- Los **impuestos** son la retención total, sin distinguir origen y destino.
- Los **gastos** se ajustan a veces en ±1 céntimo para que el saldo coincida con el del broker.
- La descripción sigue patrones repetidos («Compra 50 x XXX @ 11.73 EUR», «Dividendos XXX (36*1.52 USD)»), es decir, es derivable de los demás campos.

### 2.2 Tipos de operación encontrados

En más de 2.100 filas desde 2014 aparecen 25 tipos. Por frecuencia:

| Grupo | Tipos | Efecto |
|---|---|---|
| Rentas | `DIVIDENDOS` (≈58 % de las filas), `INTERESES`, `INGRESOPROMOCION`, `DEVOLUCIONPRIMA` | Entra efectivo; bruto, retención y gastos. La devolución de prima además reduce el coste del valor |
| Compraventa | `COMPRA`, `VENTA` | Cambia nº de acciones, coste y efectivo |
| Capital | `APORTACION` (y retiradas) | Cambia capital aportado y efectivo |
| Efectivo | `TRASPASO` entre cuentas, `CAMBIO` de divisa | Mueve efectivo; el cambio de divisa puede tener gastos |
| Derechos (scrip) | `COMPRADERECHOS`, `VENTADERECHOS`, `VENTADERECHOSCONRETENCION`, `CONVERSIONDERECHOS`, `AMPLIACIONLIBERADA` | Acciones nuevas a coste cero o comprando derechos; la venta de derechos reduce el coste |
| Corporativas | `SPLIT` (incluye contrasplit, como factor), `SPINOFF`, `CONVERSION` (cambio de ticker o fusión de clases) | Cambian nº de acciones o ticker sin flujo de efectivo, salvo picos |
| Gastos | `GASTOS`, `COMISIONESCUSTODIA`, `COMISIONESGESTION`, `COMISIONESMANTENIMIENTO` | Sale efectivo |
| Otros | `VENTAPUT`, `COMPRACALL`, `PERDIDASFONDOS`, `COMPENSACIONFONDOS` | Casos puntuales (opciones, fondo monetario del broker) |

### 2.3 Columnas calculadas por fila

- **Resultado neto de la operación** = ingresos brutos − impuestos − gastos (en euros).
- **Capital invertido** acumulado = anterior + aportación − retirada.
- **Ganancias acumuladas del año**, que se reinician cada 1 de enero.
- **Saldo de cada cuenta de efectivo**: 4 cuentas (3 brokers; uno con cuenta en EUR y otra en USD). Cada fila arrastra el saldo anterior y aplica la operación.
- **Por cada valor (≈60 tickers), cuatro bloques de columnas** arrastradas fila a fila:
  1. coste acumulado (importe de compras sin comisiones),
  2. coste ajustado, descontando ventas de derechos y devoluciones de prima,
  3. valor de mercado (solo se rellena a final de año o trimestre),
  4. nº de acciones.

Esto da cerca de 300 columnas y unas 380.000 fórmulas: es la causa de la lentitud.

### 2.4 Cabecera: métricas anuales y objetivos

Para cada año, y para el total histórico, se calculan cinco métricas sumando rangos de filas fijados a mano:

| Métrica | Cálculo |
|---|---|
| Aumento de capital | aportaciones − retiradas |
| Ingresos | suma de ingresos brutos |
| Gastos | suma de gastos |
| Rendimiento bruto | ingresos − gastos |
| Rendimiento neto | ingresos − impuestos − gastos |
| Compras | suma de importes de compra sin comisiones (neto de ventas) |

Para el año en curso hay un **objetivo** por métrica y el **% de consecución**, junto a la fracción de año transcurrida como referencia («previsto»). También se muestra la liquidez total, convirtiendo la cuenta en USD con el cambio del momento.

Al pie del registro hay notas con los próximos dividendos esperados (fecha, cuenta, valor, acciones × importe), usadas como recordatorio.

### 2.5 Fragilidades detectadas

- Los rangos de fila de cada año están escritos a mano en decenas de fórmulas. Al menos una celda (rendimiento neto de un año en la tabla histórica) suma un rango que abarca varios años, y la columna del año anterior incluye también las filas del año en curso.
- `Control cartera` apunta, valor por valor, a una fila concreta del `Log` (la última en que cambió), que hay que actualizar a mano tras cada operación.
- Monedas mal tecleadas en algunas filas (`EU`, `UEUR`, el nombre de una cuenta en lugar de la moneda) y unas 560 filas sin moneda.
- No hay validación: tipo de operación, ticker y cuenta son texto libre.

## 3. Logs de los hijos

Misma estructura de entrada, simplificada (sin importes en moneda local) y con tres cuentas de efectivo. La diferencia es que posición y coste por valor **no se arrastran**: se calculan con una fórmula de agregación (`DSUM`) sobre el registro, filtrando por ticker y tipo de operación. Es el modelo a generalizar. Incluye también valor de mercado por valor y un apunte de texto con las propuestas de compra y la elección de cada periodo.

## 4. `Control cartera`

Una columna por valor (histórico de ≈60, de los que algo más de 40 tienen posición) y una columna de totales.

**Datos por valor**

| Dato | Origen |
|---|---|
| Ticker (formato Google Finance, p. ej. `BME:XXX`, `LON:XXX`), país, moneda | Manual |
| Sector y supersector (cíclico, defensivo, sensible) | Manual |
| Nº de acciones, coste, coste reducido | `Log` |
| Precio actual y tipo de cambio | `GOOGLEFINANCE` |
| Retención en origen y en destino (%) | Manual |
| Dividendo por acción previsto en cada uno de los 12 meses, en moneda local | Manual |
| ¿Reinvertir dividendos? (Sí/No) | Manual |
| Dividendos brutos cobrados por mes desde 2014 | Copiado a mano desde `Log` |

**Cálculos por valor**

- Precio medio de compra = coste reducido / nº de acciones (en € y en moneda local).
- Valor actual = precio × nº de acciones; en € dividiendo por el tipo de cambio.
- P/G = valor actual − coste reducido; P/G % = P/G / coste reducido.
- Dividendo por acción anual (DPA) = suma de los 12 meses previstos, pasado a €.
- Dividendo bruto previsto = DPA × nº de acciones.
- Dividendo neto previsto = bruto × (1 − retención origen) × (1 − retención destino).
- Dividendo mensual previsto = DPA del mes × nº de acciones.
- YOC neto = dividendo neto / coste reducido.
- RPD (yield) bruta y neta = dividendo bruto o neto / valor actual.
- Peso sobre el total de dividendos y sobre el valor de mercado.
- Dividendos brutos cobrados históricos, % sobre el coste («cuánto se ha recuperado») y cobrados desde la última compra («cuánto queda por reinvertir en este valor»).

**Totales**

- **PADI** (dividendos brutos previstos a 12 meses), neto, media mensual bruta y neta, tipo impositivo efectivo.
- Coste total, valor de mercado, capital aportado, capital menos liquidez.
- P/G total = valor de mercado + liquidez − capital aportado.
- Nº de valores y peso equiponderado de referencia (100 % / nº de valores).
- Texto resumen con valor de mercado, liquidez, % de liquidez y nivel de tres índices.
- Gráficos de valor de mercado y de dividendos.

## 5. `Valores en estudio`

Una fila por valor (≈78), en cartera o candidato, agrupados por zona (España, EE. UU., Reino Unido, resto de Europa, especulativos). Campos: nombre, ticker, dividendo por acción (a veces como suma de pagos), yield, BPA, PER a precio actual y a precio objetivo, precio actual, % de distancia al objetivo, precio objetivo y su explicación, tesis de inversión, precio medio de compra (fórmula escrita a mano con cada compra), lista de compras en texto, fechas de resultados y variaciones de dividendo, enlaces a análisis de terceros, web de inversores y página de dividendos, y una «revisión rápida» anual (bueno / malo / qué hacer en 12 meses).

El dividendo por acción se mantiene aquí **y** en `Control cartera`; el precio medio se mantiene aquí **y** sale del `Log`. Son las duplicidades que más tiempo cuestan.

## 6. `Selección`

Cuatro listas (España, resto del mundo, EE. UU., sin *tier* / especulativos), cada una **ordenada a mano** una vez al mes de más a menos interesante.

- **Parámetros**: inversión máxima por *tier* (T1, T2, T3, con variantes «Esp») y dos umbrales de variación mensual (reseñable 4 %, grande 10 %).
- **Por valor**: país, ticker, *tier*, invertido (coste reducido, en miles de €), RPD, precio actual, precio objetivo, distancia al objetivo, variación % desde la última revisión con su descripción («sube fuerte de X a Y»), y una **línea de texto resumen** generada, del tipo `XXX +2% (11.70/9.50 +23%, RPD 3.59%, invertido 4.3K, T1, PMC 9.35)`.
- **Histórico**: una columna por cada revisión mensual (más de 30) con el precio de cada valor ese día, pegada como valores.

## 7. `Variación divs`

Una fila por cambio de dividendo: fecha, ticker, dividendo anual anterior y nuevo (como fórmula, p. ej. `4*1.24`), acciones en la fecha, moneda, tipo de cambio y enlace a la nota de prensa. Calcula el % de variación, la variación por acción y **anual en euros**, y genera una frase («XXX sube de A a B, +N %. Tengo M, el ingreso anual pasa de P a Q €»).

## 8. Vistas derivadas

- **`Análisis cartera`**: dos rankings a partir de `Control cartera`, por valor de mercado y por dividendo bruto previsto, con pesos.
- **`Evolución top 50`**: cada enero se copia el ranking como valores para comparar años.
- **`Evolución div. mes`**: tabla año × mes de rendimiento neto con total anual y gráficos.
- **`Crecimiento div`**: cada año se copian acciones, dividendo y DPA por valor a cierre, y se descompone el cambio respecto al año anterior:
  - crecimiento orgánico = min(acciones año X−1, acciones año X) × (DPA X − DPA X−1);
  - crecimiento por compras = (acciones X − acciones X−1) × DPA X (o DPA X−1 si se redujo posición);
  - comprobación = dividendo X−1 + orgánico + compras − dividendo X ≈ 0.
- **`IRPF`**: por año, ventas con ganancia o pérdida, y dividendos por cuenta, país y valor con bruto, retención y neto.

## 9. Dependencias externas

- `GOOGLEFINANCE` para precio actual de cada valor, precio en una fecha (selección mensual), tipos de cambio e índices.
- `QUERY` y fórmulas de matriz de Google Sheets para los rankings.

## 10. Resumen de problemas

1. **Entrada lenta y duplicada**: una subida de dividendo se anota en tres solapas; cada compra obliga a tocar el `Log`, la referencia de fila en `Control cartera` y el precio medio en `Valores en estudio`; los dividendos cobrados se copian a mano al histórico.
2. **Tipo de cambio manual** en cada dividendo en divisa.
3. **Rendimiento**: 300 columnas arrastradas y 13 años de filas en una sola solapa.
4. **Fragilidad**: rangos y referencias de fila escritos a mano, sin validación de datos.
5. **Procesos anuales manuales**: copiar el top 50, preparar `Crecimiento div`, archivar el año.
