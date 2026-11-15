# Especificación de la nueva herramienta

**Estado: borrador 0.1.** Las decisiones marcadas con ❓ dependen de las [preguntas abiertas](#11-decisiones-abiertas); lo demás se deriva de la [descripción de la hoja actual](descripcion-hoja-actual.md).

## 1. Objetivo

Sustituir la hoja de cálculo por una herramienta que:

- permita registrar una operación en menos de un minuto, **anotando cada dato una sola vez**;
- calcule todo lo demás (posiciones, efectivo, coste, dividendos previstos, informes) a partir del registro;
- mantenga las vistas que hoy sostienen la disciplina inversora, sobre todo el cuadro de cartera;
- cueste como máximo 5 €/mes y no dependa de fórmulas de Google Sheets para funcionar.

Fuera de alcance: operar con brokers, datos en tiempo real, asesoramiento automático.

## 2. Principios de diseño

1. **Una sola fuente de verdad**: el registro de operaciones. Posición, coste, efectivo, dividendos cobrados y métricas anuales son siempre calculados, nunca tecleados.
2. **Datos maestros únicos por valor**: el dividendo previsto, el precio objetivo o la retención se guardan en un solo sitio y alimentan todas las vistas.
3. **Histórico por fecha**: cualquier magnitud (acciones, coste, efectivo, capital) se puede consultar a una fecha arbitraria.
4. **Los datos son del usuario**: exportación completa en formato abierto en cualquier momento.

## 3. Usuarios y carteras

- Un único usuario con acceso de escritura. ❓ (P2)
- Varias **carteras** independientes (hoy tres: la propia y una por hijo), cada una con sus cuentas, operaciones y objetivos. Los valores y sus datos maestros son comunes.
- Todas las vistas se pueden ver por cartera; ❓ si además hace falta una vista consolidada (P3).

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
- **RF-02** Tipos soportados: compra, venta, dividendo, interés, aportación, retirada, traspaso entre cuentas, cambio de divisa, gasto o comisión, devolución de prima, compra / venta / conversión de derechos, ampliación liberada, *split* y contrasplit, *spin-off*, conversión de ticker. ❓ Opciones y otros casos raros (P7).
- **RF-03** En operaciones en divisa se **sugiere el tipo de cambio oficial** de la fecha, editable. Se guarda el cambio realmente aplicado.
- **RF-04** Se registran por separado **retención en origen y en destino**. Al dar de alta un dividendo se precalculan con los porcentajes del valor.
- **RF-05** Ajuste de céntimos: los gastos e importes son editables a mano para cuadrar con el broker, y al guardar se muestra el **saldo resultante de la cuenta** para comprobarlo.
- **RF-06** **Dividendos esperados**: a partir del calendario de dividendos y de la posición, la aplicación propone los cobros pendientes; confirmar uno solo requiere revisar importe y cambio. Sustituye a las notas al pie del registro. ❓ (P9)
- **RF-07** Listado de operaciones con filtro por cartera, año, tipo, valor y cuenta, y búsqueda de texto.
- **RF-08** Validación: tipo, valor, cuenta y moneda se eligen de listas; no se permite vender más acciones de las que hay ni dejar una cuenta en negativo sin confirmación.
- **RF-09** ❓ Importación de extractos de los brokers en CSV para proponer operaciones (P10).

### 5.2 Efectivo y capital

- **RF-10** Saldo de cada cuenta a cualquier fecha, en su moneda y en euros, y liquidez total.
- **RF-11** Capital aportado acumulado a cualquier fecha (aportaciones − retiradas).
- **RF-12** Conciliación: introducir el saldo real del broker y ver la diferencia.

### 5.3 Posiciones y coste

- **RF-13** Por valor y a cualquier fecha: nº de acciones, coste bruto, coste reducido (descontando ventas de derechos y devoluciones de prima) y precio medio.
- **RF-14** Total invertido a cualquier fecha, completo y reducido.
- **RF-15** Tratamiento del coste en ventas parciales ❓ (P6): la hoja usa coste medio; para IRPF hace falta FIFO.

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

- **RF-31** Listas por zona ordenables a mano (arrastrar), con las columnas actuales: *tier*, invertido, RPD, precio, objetivo, distancia, variación desde la revisión anterior.
- **RF-32** «Cerrar revisión» guarda la fecha, el orden y el precio de cada valor ese día; se conserva el histórico de revisiones y la evolución mensual de precios.
- **RF-33** Variación mensual clasificada con umbrales configurables (hoy 4 % y 10 %).
- **RF-34** Inversión máxima por *tier* configurable, con aviso al superarla. ❓ (P12)
- **RF-35** Línea de texto resumen por valor, copiable. ❓ (P13)
- **RF-36** Registro de las propuestas y de la elección de cada mes por cartera.

### 5.9 Informes

- **RF-37** **Top 50** por valor de mercado y por dividendo previsto, y su evolución anual a partir de las fotos de cartera.
- **RF-38** **Dividendos por mes y año** (brutos y netos), con gráficos comparativos.
- **RF-39** **Evolución de la inversión**: capital aportado, coste y, donde haya precios, valor de mercado.
- **RF-40** **Crecimiento de dividendos** año X frente a X−1 por valor y total: orgánico frente a compras, calculado automáticamente con las fórmulas actuales.
- **RF-41** **Informe fiscal anual** ❓ (P8): dividendos por país y valor con bruto, retención en origen, retención en destino y neto; ventas con ganancia o pérdida.
- **RF-42** Foto de cartera automática a cierre de año, y bajo demanda.

### 5.10 Precios y tipos de cambio

- **RF-43** Precio de cada valor con un retraso máximo de una hora mientras la aplicación está en uso; no hace falta tiempo real.
- **RF-44** Precio de cierre histórico en una fecha dada (para revisiones de selección y fotos).
- **RF-45** Tipo de cambio oficial diario (referencia del BCE) para EUR/USD, EUR/GBP y las monedas que se añadan.
- **RF-46** Si la fuente de precios falla, se usa el último precio conocido indicando su fecha, y se puede introducir un precio a mano.

### 5.11 Datos

- **RF-47** Exportación completa a Excel o CSV, y copia de seguridad automática.
- **RF-48** Importación del histórico desde la hoja actual ❓ (P5).

## 6. Reglas de cálculo

Con *fx* = unidades de moneda extranjera por euro.

| Magnitud | Definición |
|---|---|
| Importe en € | importe local / fx |
| Resultado neto de una operación | bruto − retenciones − gastos |
| Capital aportado | Σ aportaciones − Σ retiradas |
| Saldo de cuenta | Σ flujos de efectivo de las operaciones de esa cuenta hasta la fecha |
| Nº de acciones | Σ compras − ventas + acciones por derechos y ampliaciones, aplicando *splits* |
| Coste | Σ importes de compra sin comisiones − coste de lo vendido |
| Coste reducido | coste − ventas de derechos − devoluciones de prima |
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
- **Seguridad**: acceso con autenticación; datos financieros personales cifrados en tránsito; sin datos reales en el repositorio.
- **Copias**: copia diaria automática cuando haya cambios, con al menos 30 días de retención.
- **Dispositivos**: navegador de escritorio y móvil Android.
- **Idioma**: español; formato numérico y de fecha español.

## 8. Arquitectura propuesta

**Recomendación: aplicación web instalable (PWA)**, que cubre PC y Android con un solo desarrollo. Una nueva hoja de cálculo no resuelve la duplicidad de datos ni la lentitud, y una app Android nativa deja fuera el PC, donde la entrada de datos y las tablas anchas son más cómodas.

| Pieza | Propuesta | Alternativas |
|---|---|---|
| Interfaz | Web *responsive* instalable como PWA | App nativa; hoja de cálculo simplificada |
| Servidor | Contenedor que **escala a cero**: arranca con la primera petición y se para solo al quedar inactivo | Servidor virtual siempre encendido |
| Datos | SQLite en un único fichero, con copia continua a almacenamiento de objetos | PostgreSQL gestionado con capa gratuita |
| Precios ❓ (P4) | Hoja de Google mínima con `GOOGLEFINANCE` publicada como CSV, que la aplicación lee y cachea | API de precios gratuita o de pago |
| Tipos de cambio | Referencia diaria del BCE (gratuita) | El mismo proveedor de precios |
| Acceso | Inicio de sesión con cuenta de Google restringido a direcciones autorizadas | Usuario y contraseña |

El volumen de datos es mínimo (decenas de megas como mucho), así que el coste lo determina solo el tiempo de servidor encendido; con unas horas a la semana cabe holgadamente en el presupuesto. El proveedor concreto y sus precios vigentes se elegirán en la fase de diseño.

La fuente de precios es la pieza de más riesgo: las API gratuitas cubren bien EE. UU. pero de forma irregular Madrid, Ámsterdam, Londres y Copenhague. La hoja-puente con `GOOGLEFINANCE` conserva exactamente la cobertura actual a coste cero y deja la hoja reducida a una lista de tickers; se aísla detrás de una interfaz para poder cambiarla.

## 9. Migración

1. Importar los datos maestros de valores desde `Control cartera` y `Valores en estudio`.
2. Importar las operaciones de los tres registros, normalizando tipos, monedas y cuentas. ❓ Alcance (P5).
3. Verificar contra la hoja: acciones y coste por valor, saldo de cada cuenta y métricas anuales deben coincidir a cierre de cada año.
4. Importar calendario de dividendos, cambios de dividendo, histórico de revisiones de selección y fotos anuales del top 50.
5. Periodo en paralelo con la hoja hasta validar un mes completo.

## 10. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| 1 | Modelo de datos, registro de operaciones, efectivo, posiciones, migración y verificación | Se puede dejar de usar `Log` |
| 2 | Precios y cambios, cuadro de cartera, calendario y cambios de dividendo, métricas y objetivos | Se puede dejar de usar `Control cartera` y `Variación divs` |
| 3 | Valores en estudio y selección mensual | Se puede dejar de usar la hoja |
| 4 | Informes (top 50, evolución, crecimiento, fiscal), dividendos esperados, importación de extractos | Se eliminan los procesos manuales anuales |

## 11. Decisiones abiertas

| # | Pregunta | Afecta a |
|---|---|---|
| P1 | Tipo de herramienta y dispositivos de uso | §8 |
| P2 | Quién accede y con qué permisos | §3 |
| P3 | Vista consolidada de las tres carteras | §3 |
| P4 | Fuente de precios: hoja-puente con `GOOGLEFINANCE` u otra | RF-43, §8 |
| P5 | Alcance de la migración del histórico | RF-48, §9 |
| P6 | Método de coste en ventas (medio / FIFO) | RF-15 |
| P7 | Tipos de operación a mantener | RF-02 |
| P8 | Alcance del informe fiscal | RF-41 |
| P9 | Dividendos esperados y origen del calendario | RF-06, RF-16 |
| P10 | Importación de extractos de brokers | RF-09 |
| P11 | Histórico de valor de mercado | RF-39, RF-42 |
| P12 | Significado de los *tiers* y de la inversión máxima | RF-34 |
| P13 | Uso de la línea de texto resumen | RF-35 |
| P14 | Tecnología y mantenimiento | §8 |
| P15 | Visibilidad del repositorio | §7 |
