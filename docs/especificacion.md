# Especificación de la nueva herramienta

**Estado: versión 1.0, cerrada para pasar a diseño.** Incorpora las [decisiones tomadas](#11-decisiones-tomadas) con el propietario; lo demás se deriva de la [descripción de la hoja actual](descripcion-hoja-actual.md).

## 1. Objetivo

Sustituir la hoja de cálculo por una herramienta que:

- permita registrar una operación en menos de un minuto, **anotando cada dato una sola vez**;
- calcule todo lo demás (posiciones, efectivo, coste, dividendos previstos, informes) a partir del registro;
- mantenga las vistas que hoy sostienen la disciplina inversora, sobre todo el cuadro de cartera;
- cueste como máximo 5 €/mes y no dependa de fórmulas de Google Sheets para funcionar.

Fuera del alcance inicial: apartado fiscal (IRPF, modelo 720), operar con brokers, datos en tiempo real y asesoramiento automático.

## 2. Principios de diseño

1. **Una sola fuente de verdad**: el registro de operaciones. Posición, coste, efectivo, dividendos cobrados y métricas anuales son siempre calculados, nunca tecleados.
2. **Datos maestros únicos por valor**: el dividendo previsto, el precio objetivo o la retención se guardan en un solo sitio y alimentan todas las vistas.
3. **Histórico por fecha**: cualquier magnitud (acciones, coste, efectivo, capital) se puede consultar a una fecha arbitraria.
4. **Los datos son del usuario**: exportación completa en formato abierto en cualquier momento.

## 3. Usuarios y carteras

- Un único usuario; nadie más accede, ni en modo lectura.
- Varias **carteras** independientes (hoy tres: la propia y una por hijo), cada una con sus cuentas, operaciones y objetivos. Los valores y sus datos maestros son comunes.
- Todas las vistas son por cartera. No hay vista consolidada.

## 4. Modelo de datos

| Entidad | Campos principales |
|---|---|
| **Cartera** | nombre, moneda base (EUR) |
| **Cuenta** | cartera, broker, nombre, moneda (una cuenta = un saldo de efectivo en una moneda) |
| **Valor** | ticker interno, ticker del proveedor de precios, nombre, mercado, país, moneda de cotización, moneda del dividendo, sector, supersector, zona (ES / US / UK / resto Europa / especulativo), *tier*, retención origen %, retención destino %, ¿reinvertir? |
| **Ficha de estudio** (1:1 con valor) | BPA, precio objetivo, fecha y explicación del objetivo, tesis, enlaces (web inversores, dividendos, análisis), notas, revisiones anuales |
| **Operación** | cartera, fecha, tipo, cuenta, valor, cantidad, precio, moneda, tipo de cambio, importe bruto, retención origen, retención destino, gastos, importe neto en moneda de la cuenta, cuenta destino (traspasos y cambios), notas |
| **Calendario de dividendos** | valor, mes de pago, importe por acción, moneda, vigente desde |
| **Cambio de dividendo** | valor, fecha, DPA anual anterior, DPA anual nuevo, enlace, nota (genera la nueva versión del calendario) |
| **Precio** | valor, fecha, cierre |
| **Tipo de cambio** | moneda, fecha, cambio oficial frente al euro |
| **Objetivo anual** | cartera, año, métrica, importe |
| **Revisión de selección** | fecha, y por valor: lista, posición en el orden, precio ese día, nota |
| **Foto de cartera** | cartera, fecha, y por valor: acciones, coste, valor de mercado, dividendo previsto |

Los importes monetarios se guardan como decimales exactos con su moneda, nunca en coma flotante.

## 5. Requisitos funcionales

### 5.1 Registro de operaciones

- **RF-01** Alta, edición y borrado de operaciones con formulario específico por tipo: solo se piden los campos que aplican y la descripción se genera sola.
- **RF-02** Tipos soportados: compra, venta, dividendo, interés, aportación, retirada, traspaso entre cuentas, cambio de divisa, gasto o comisión, devolución de prima, compra / venta / conversión de derechos, ampliación liberada, *split* y contrasplit, *spin-off*, conversión de ticker, venta y compra de opciones (*put* / *call*), y pérdidas y compensaciones de fondos monetarios del broker. Son los 25 tipos de la hoja actual; todos siguen en uso.
- **RF-03** En operaciones en divisa se **sugiere el tipo de cambio oficial** de la fecha, editable. Se guarda el cambio realmente aplicado.
- **RF-04** Se registran por separado **retención en origen y en destino**. Al dar de alta un dividendo se precalculan con los porcentajes del valor.
- **RF-05** Ajuste de céntimos: los gastos e importes son editables a mano para cuadrar con el broker, y al guardar se muestra el **saldo resultante de la cuenta** para comprobarlo.
- **RF-06** **Entrada en cualquier orden y por lotes**: las operaciones se pueden introducir sin respetar el orden cronológico; saldos y posiciones se recalculan siempre por fecha. Hay un modo de alta rápida para meter seguidos todos los dividendos de una cuenta en un periodo (se fija la cuenta, y cada línea pide valor, fecha, importe y retención), y después los de otra cuenta aunque las fechas se intercalen. Hace innecesarias las notas de próximos dividendos al pie del registro.
- **RF-07** **Listado de movimientos** (consulta principal del registro, equivalente a la solapa `Log`): operaciones de una cartera ordenadas por fecha, una por fila, con sus datos (fecha, descripción, tipo, valor, cantidad, precio, moneda, cambio, cuenta, bruto, retención, gastos, resultado neto) y, **en cada fila, los acumulados tras esa operación**:
  - saldo de cada cuenta de efectivo, en su moneda;
  - capital invertido (aportaciones − retiradas);
  - ganancias acumuladas del año, que se reinician cada 1 de enero.

  Los acumulados se calculan siempre sobre todas las operaciones por orden de fecha, de modo que no cambian al filtrar ni dependen del orden en que se introdujeron. Las operaciones de un mismo día mantienen un orden estable y ajustable a mano. El listado se filtra por año, tipo, valor y cuenta, admite búsqueda de texto, muestra por defecto el año en curso con lo más reciente a la vista y permite editar una operación desde su fila. La cabecera muestra las métricas del año y los objetivos (RF-25 y RF-26). En móvil se muestra una versión reducida.
- **RF-08** Validación: tipo, valor, cuenta y moneda se eligen de listas; no se permite vender más acciones de las que hay ni dejar una cuenta en negativo sin confirmación.
- **RF-09** A medio plazo (fase 4): importación de los extractos CSV de Degiro e Interactive Brokers, que propone operaciones para revisar antes de guardarlas y detecta las ya registradas. ING no exporta, así que sus operaciones se introducen a mano.

### 5.2 Efectivo y capital

- **RF-10** Saldo de cada cuenta a cualquier fecha, en su moneda y en euros, y liquidez total.
- **RF-11** Capital aportado acumulado a cualquier fecha (aportaciones − retiradas).
- **RF-12** Conciliación: introducir el saldo real del broker y ver la diferencia.

### 5.3 Posiciones y coste

- **RF-13** Por valor y a cualquier fecha: nº de acciones, coste bruto, coste reducido (descontando ventas de derechos sin retención y devoluciones de prima) y precio medio.
- **RF-14** Total invertido a cualquier fecha, completo y reducido.
- **RF-15** El coste se lleva por **lotes de compra con criterio FIFO**: una venta da de baja las acciones más antiguas a su coste original, y lo que queda conserva el suyo. Se aplica a todo el histórico, también a las operaciones migradas. De los lotes salen el coste del valor, su precio medio y la plusvalía realizada de cada venta.

### 5.4 Dividendos previstos y cambios de dividendo

- **RF-16** Cada valor tiene un calendario de pagos previstos (importe por acción y mes). De él salen DPA anual, PADI y previsión mensual.
- **RF-17** **Registrar un cambio de dividendo es una única acción**: actualiza el calendario y deja constancia con fecha, % de variación, acciones en ese momento, efecto anual en euros y frase resumen. Sustituye a la triple anotación actual.
- **RF-18** Vista de cambios de dividendo por año con el total de euros anuales ganados o perdidos por *dividend growth*.

### 5.5 Cuadro de cartera (vista principal)

- **RF-19** Tabla por valor con: acciones, precio medio, coste, precio actual, valor de mercado, P/G en € y %, peso, DPA, dividendo bruto y neto previsto, YOC, RPD bruta y neta, peso en dividendos, dividendos cobrados históricos, % del coste recuperado y cobrado desde la última compra.
- **RF-20** Totales: valor de mercado, liquidez y su %, capital aportado, P/G total, PADI bruto y neto, media mensual, YOC y RPD de la cartera, nº de valores.
- **RF-21** Previsión de dividendos mes a mes para los próximos 12 meses.
- **RF-22** Indicador de reinversión por valor: cuánto ha generado, cuánto se ha reinvertido en él y cuánto falta para mantener el equilibrio.
- **RF-23** Ordenable y filtrable por zona, sector y *tier*; usable en móvil.
- **RF-24** Gráficos de distribución por valor, sector y país, en valor de mercado y en dividendos.

### 5.6 Métricas anuales y objetivos

- **RF-25** Por año y cartera: aumento de capital, ingresos brutos, gastos, rendimiento bruto, rendimiento neto y compras netas, calculados por fecha de la operación.
- **RF-26** Objetivos del año en curso por métrica, con % de consecución y comparación con la fracción de año transcurrida.

### 5.7 Valores en estudio

- **RF-27** Ficha por valor con datos de mercado calculados (precio, yield, PER actual y a precio objetivo, distancia al objetivo, precio medio propio) y datos manuales (BPA, objetivo, tesis, enlaces, notas).
- **RF-28** Aviso de precio objetivo sin revisar en más de 12 meses.
- **RF-29** Revisión rápida anual por valor (bueno / malo / acción a 12 meses), con histórico.
- **RF-30** Lista agrupada por zona, con filtros «en cartera» y «cerca del objetivo».

### 5.8 Selección mensual

- **RF-31** Listas por zona ordenables a mano (arrastrar, flechas o teclado), con las columnas actuales: *tier*, invertido, RPD, precio, objetivo, distancia, variación desde la revisión anterior. La pantalla se puede manejar solo con el teclado (cambiar de fila, moverla, copiar su línea, ver su gráfico, editar el valor), y editar un valor no hace perder el orden sin guardar.
- **RF-32** «Cerrar revisión» guarda la fecha, el orden y el precio de cada valor ese día; se conserva el histórico de revisiones y la evolución mensual de precios.
- **RF-33** Variación mensual clasificada con umbrales configurables (hoy 4 % y 10 %). Para cada valor se pueden ver de un vistazo las variaciones de las últimas 24 revisiones con sus colores y precios, como en la hoja, junto al gráfico de evolución con las compras marcadas.
- **RF-34** Inversión máxima por valor según *tier* y zona, configurable y con aviso al acercarse o superarla. Valores iniciales en miles de euros: España T1 6, T2 4, T3 1,5; resto del mundo T1 5, T2 3, T3 1. Los valores sin *tier* no tienen límite definido.
- **RF-35** Línea de texto resumen por valor con el formato actual (`XXX +2% (11.70/9.50 +23%, RPD 3.59%, invertido 4.3K, T1, PMC 9.35)`), con botón para copiar una línea o una lista entera, porque se pega en un fichero de texto externo donde se anotan las decisiones y los datos que las justifican.
- **RF-36** Registro de las propuestas y de la elección de cada mes por cartera.

### 5.9 Informes

- **RF-37** **Top 50** por valor de mercado y por dividendo previsto, y su evolución anual a partir de las fotos de cartera.
- **RF-38** **Dividendos por mes y año** (brutos y netos), con gráficos comparativos.
- **RF-39** **Evolución de la inversión**: capital aportado, coste y, donde haya precios, valor de mercado.
- **RF-40** **Crecimiento de dividendos** año X frente a X−1 por valor y total: orgánico frente a compras, calculado automáticamente con las fórmulas actuales.
- **RF-41** *(Excluido del diseño inicial.)* Informe fiscal anual. Las retenciones en origen y destino se guardan desde el principio (RF-04) para poder añadirlo después.
- **RF-42** Foto de cartera automática al cierre de cada trimestre y de cada año, con el precio de cierre de ese día, y bajo demanda. Si la aplicación estaba parada en esa fecha, la foto se genera en el siguiente arranque con precios históricos.

### 5.10 Precios y tipos de cambio

- **RF-43** Precio de cada valor con un retraso máximo de una hora mientras la aplicación está en uso; no hace falta tiempo real.
- **RF-44** Precio de cierre histórico en una fecha dada (para revisiones de selección y fotos).
- **RF-45** Tipo de cambio oficial diario (referencia del BCE) para EUR/USD, EUR/GBP y las monedas que se añadan.
- **RF-46** Si la fuente de precios falla, se usa el último precio conocido indicando su fecha, y se puede introducir un precio a mano.

### 5.11 Datos

- **RF-47** Exportación completa de los datos en formato abierto (CSV o Excel, una tabla por entidad) y copia de seguridad automática.
- **RF-49** **Exportación de validación con el formato de la hoja actual**: genera un libro de cálculo cuyas solapas reproducen la disposición de la hoja (mismas columnas, en el mismo orden) para poder compararlas lado a lado durante el periodo en paralelo:
  - registro de cada cartera como en `Log`: columnas de entrada, resultado neto, capital invertido, ganancias acumuladas del año, saldo de cada cuenta y, por valor, los bloques de coste, coste reducido y nº de acciones, más la cabecera de métricas anuales;
  - cuadro de cartera como en `Control cartera`: una columna por valor con las mismas filas, incluido el histórico de dividendos cobrados por mes.

  Los datos se exportan como valores, no como fórmulas. La exportación incluye una solapa de **diferencias** cuando se le da como referencia una copia de la hoja actual: celdas que no coinciden por encima de una tolerancia de un céntimo, por fecha y columna. El fichero se genera bajo demanda y se descarga; no se guarda en el repositorio.
- **RF-48** Importación de **todo el histórico** desde la hoja actual: las operaciones desde 2014 de la cartera propia y las de los hijos.

## 6. Reglas de cálculo

Con *fx* = unidades de moneda extranjera por euro.

| Magnitud | Definición |
|---|---|
| Importe en € | importe local / fx |
| Resultado neto de una operación | bruto − retenciones − gastos |
| Capital aportado | Σ aportaciones − Σ retiradas |
| Saldo de cuenta | Σ flujos de efectivo de las operaciones de esa cuenta hasta la fecha |
| Nº de acciones | Σ compras − ventas + acciones por derechos y ampliaciones, aplicando *splits* |
| Coste | Σ coste de los lotes de compra vivos (FIFO) |
| Coste reducido | coste − ventas de derechos sin retención − devoluciones de prima |
| Precio medio | coste reducido / nº de acciones |
| Valor de mercado € | precio × acciones / fx |
| P/G del valor | valor de mercado − coste reducido |
| P/G de la cartera | valor de mercado + liquidez − capital aportado |
| DPA anual | Σ pagos previstos en 12 meses |
| Dividendo bruto previsto | DPA × acciones / fx |
| Dividendo neto previsto | bruto × (1 − ret. origen) × (1 − ret. destino) |
| PADI | Σ dividendo bruto previsto de todos los valores |
| YOC | dividendo previsto / coste reducido |
| RPD | dividendo previsto / valor de mercado |
| % recuperado | dividendos brutos cobrados / coste |
| Efecto de un cambio de dividendo | (DPA nuevo − DPA anterior) × acciones / fx |
| Crecimiento orgánico (año X) | min(acc. X−1, acc. X) × (DPA X − DPA X−1) |
| Crecimiento por compras (año X) | (acc. X − acc. X−1) × DPA X; con DPA X−1 si la posición baja |
| Distancia al objetivo | (precio − objetivo) / objetivo |
| Consecución de objetivo | valor actual de la métrica / objetivo |

## 7. Requisitos no funcionales

- **Coste**: ≤ 5 €/mes en total (alojamiento, base de datos, precios, dominio si lo hay).
- **Disponibilidad bajo demanda**: uso de unas 2 horas semanales. El servidor puede estar parado; debe **arrancar solo al abrir la aplicación** y pararse solo tras un rato sin uso, o con un botón. Arranque en menos de 30 segundos.
- **Rendimiento**: cualquier vista en menos de 2 segundos con 15 años de operaciones (del orden de 5.000 filas).
- **Seguridad**: acceso con autenticación; datos cifrados en tránsito.
- **Privacidad del repositorio**: el repositorio es público. Pueden aparecer la composición de la cartera (qué valores) y los parámetros de la estrategia (límites por *tier*), pero **nunca el volumen real**: ni importes, ni nº de acciones, ni saldos, ni dividendos cobrados. La hoja original, la base de datos y sus copias quedan fuera del repositorio, y las pruebas usan datos ficticios.
- **Copias**: copia diaria automática cuando haya cambios, con al menos 30 días de retención.
- **Dispositivos**: Chromebook como equipo principal (toda la funcionalidad) y móvil Android para consultar y hacer apuntes sueltos.
- **Idioma**: español; formato numérico y de fecha español.

## 8. Arquitectura propuesta

**Recomendación: aplicación web instalable (PWA)**, que cubre PC y Android con un solo desarrollo. Una nueva hoja de cálculo no resuelve la duplicidad de datos ni la lentitud, y una app Android nativa deja fuera el PC, donde la entrada de datos y las tablas anchas son más cómodas.

| Pieza | Propuesta | Alternativas |
|---|---|---|
| Interfaz | Web *responsive* instalable como PWA | App nativa; hoja de cálculo simplificada |
| Servidor | Contenedor que **escala a cero**: arranca con la primera petición y se para solo al quedar inactivo | Servidor virtual siempre encendido |
| Datos | SQLite en un único fichero, con copia continua a almacenamiento de objetos | PostgreSQL gestionado con capa gratuita |
| Precios | Hoja de Google mínima con `GOOGLEFINANCE` publicada como CSV, que la aplicación lee y cachea | API de precios gratuita o de pago |
| Tipos de cambio | Referencia diaria del BCE (gratuita) | El mismo proveedor de precios |
| Dominio | `invest.jdmuriel.com`, subdominio de un dominio ya existente, sin coste añadido | — |
| Acceso | Inicio de sesión con cuenta de Google restringido a una dirección autorizada | Usuario y contraseña |
| Tecnología | Un único proyecto TypeScript (interfaz y servidor) empaquetado en un contenedor; se concreta en la fase de diseño | Python en servidor con interfaz ligera |

El volumen de datos es mínimo (decenas de megas como mucho), así que el coste lo determina solo el tiempo de servidor encendido; con unas horas a la semana cabe holgadamente en el presupuesto. El proveedor concreto y sus precios vigentes se elegirán en la fase de diseño.

La fuente de precios es la pieza de más riesgo: las API gratuitas cubren bien EE. UU. pero de forma irregular Madrid, Ámsterdam, Londres y Copenhague. La hoja-puente con `GOOGLEFINANCE` conserva exactamente la cobertura actual a coste cero y deja la hoja reducida a una lista de tickers; se aísla detrás de una interfaz para poder cambiarla.

## 9. Migración

1. Importar los datos maestros de valores desde `Control cartera` y `Valores en estudio`.
2. Importar todas las operaciones de los tres registros desde 2014, normalizando tipos, monedas y cuentas (hay monedas mal tecleadas y filas sin moneda). La importación se ejecuta sobre el fichero local, que no se sube al repositorio.
3. Verificar contra la hoja: acciones y coste por valor, saldo de cada cuenta y métricas anuales deben coincidir a cierre de cada año.
4. Importar calendario de dividendos, cambios de dividendo, histórico de revisiones de selección y fotos anuales del top 50.
5. Periodo en paralelo con la hoja hasta validar un mes completo, comparando con la exportación de validación (RF-49).

## 10. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| 1 | Modelo de datos, registro de operaciones con alta rápida por lotes, efectivo, posiciones, migración y verificación | Se puede dejar de usar `Log` |
| 2 | Precios y cambios, cuadro de cartera, calendario y cambios de dividendo, métricas y objetivos | Se puede dejar de usar `Control cartera` y `Variación divs` |
| 3 | Valores en estudio y selección mensual | Se puede dejar de usar la hoja |
| 4 | Informes (top 50, evolución, crecimiento de dividendos), fotos trimestrales, importación de extractos de Degiro e IB | Se eliminan los procesos manuales anuales |

## 11. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Tipo de herramienta | Aplicación web instalable; Chromebook como equipo principal y apuntes desde el móvil |
| Acceso | Solo el propietario |
| Carteras | Siempre vistas separadas, sin consolidado |
| Precios | Hoja de Google mínima con `GOOGLEFINANCE` como fuente |
| Histórico | Se migran todas las operaciones previas |
| Coste en ventas | FIFO sobre el coste original, aplicado a todo el histórico |
| Tipos de operación | Se mantienen los 25 actuales |
| Fiscalidad | Fuera del diseño inicial |
| Próximos dividendos | No hace falta calendario de cobros esperados; basta poder introducir operaciones en cualquier orden y por lotes |
| Extractos de brokers | A medio plazo, para Degiro e Interactive Brokers |
| Valor de mercado histórico | Foto al cierre de cada trimestre y de cada año |
| *Tiers* | Límite por valor en miles de euros: España 6 / 4 / 1,5; resto 5 / 3 / 1 |
| Texto resumen | Se conserva, copiable, para el fichero externo de decisiones |
| Tecnología | Sin preferencia; se propone en la fase de diseño |
| Repositorio | Público; puede mostrar composición y parámetros, nunca volúmenes reales |

## 12. Grado de avance

Situación de cada requisito a 16 de noviembre de 2026. Los requisitos no cambian; esta tabla solo dice qué está hecho. Las tareas concretas están en el [plan](plan.md) y lo que difiere de la hoja en las [incidencias de la migración](incidencias-migracion.md).

| Requisitos | Asunto | Estado |
|---|---|---|
| RF-01 a RF-05, RF-08 | Alta, edición y borrado de operaciones, retenciones, ajuste de céntimos y validaciones | Hecho |
| RF-03 | Sugerencia del tipo de cambio oficial | Hecho; pendiente de verse en producción con datos del BCE |
| RF-06 | Entrada en cualquier orden y por lotes | La entrada en cualquier orden, hecha. El **alta rápida por lotes queda aplazada** por decisión del propietario |
| RF-07 | Listado de movimientos con acumulados | Hecho |
| RF-09 | Importación de extractos CSV | Fase 4 |
| RF-10 a RF-12 | Saldos, capital y conciliación | Hecho |
| RF-13 a RF-15 | Posiciones, coste y lotes FIFO | Hecho |
| RF-16 a RF-18 | Calendario y cambios de dividendo | Hecho. El calendario anterior a la migración no se puede reconstruir |
| RF-19 a RF-21, RF-23, RF-24 | Cuadro de cartera, totales, previsión, orden y filtros, distribución | Hecho. Los filtros por zona y *tier* aparecerán cuando esos datos se importen (fase 3) |
| RF-22 | Indicador de reinversión | Parcial: se muestra lo cobrado desde la última compra; falta definir «mantener el equilibrio» |
| RF-25, RF-26 | Métricas anuales y objetivos | Hecho. La fracción de año se mide por días |
| RF-27 a RF-30 | Valores en estudio | Fase 3, sin empezar. El precio objetivo y el dividendo estimado ya están en la ficha del valor (los usa la selección) |
| RF-31 a RF-36 | Selección mensual | Hecho (`/seleccion`): listas por zona y *tier* ordenables, cierre de revisión, histórico importado, máximos por *tier* y zona, línea resumen copiable, propuestas y elección. Variación coloreada (verde si sube, rojo si baja; claro si es reseñable, oscuro si es grande) y evolución del precio de cada valor en las revisiones, en una línea por fila (24 meses) que se despliega en un gráfico (hasta 5 años) con el objetivo, las compras y la tabla de las 24 últimas variaciones. Manejo con teclado y ficha del valor en ventana emergente |
| RF-38 | Dividendos por mes y año | Hecho (`/dividendos`, solapa «Historial»): evolución del acumulado anual frente al año anterior con gráfico y fecha en que se supera, comparación de un mes con el mismo mes del año y del trimestre anterior con la causa de cada diferencia y texto para copiar, cobros de un valor desde 2014 y tabla completa; bruto, neto o por acción |
| RF-40 | Crecimiento de dividendos | En parte: reparto mes a mes entre compras, dividendo por acción y tipo de cambio (vista Mes del historial); falta el resumen anual |
| RF-37, RF-39, RF-42 | Informes y fotos de cartera | Fase 4, sin empezar |
| RF-41 | Informe fiscal | Excluido |
| RF-43, RF-46 | Precios con una hora de retraso, último conocido y precio a mano | Hecho; falta que el propietario cree la hoja de precios |
| RF-44 | Precio de cierre histórico | Pendiente (pestaña `cierre`, con las fotos de la fase 4) |
| RF-45 | Tipos de cambio del BCE | Hecho; sin probar contra el servidor real |
| RF-47 | Exportación completa y copia automática | Parcial: descarga y restauración manual. Falta la copia externa automática y la exportación en formato abierto |
| RF-48 | Importación de todo el histórico | Hecho: operaciones, objetivos, precios, calendario y cambios de dividendo. Faltan las solapas de las fases 3 y 4 |
| RF-49 | Exportación de validación | Hecha la de `Log`; falta la de `Control cartera` |

Por fases (§10): la **fase 1** está completa salvo el alta por lotes (aplazada), la copia externa y el periodo en paralelo; la **fase 2**, salvo la exportación de validación de `Control cartera`; las **fases 3 y 4**, sin empezar.
