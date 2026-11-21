---
name: add_movement
description: Anota una operación (dividendo, compra, venta, aportación, retirada, intereses, gasto, traspaso o cambio de divisa) en investsheet de producción mediante su API. Usar cuando el usuario diga «añadir movimiento», «añadir operación», «anotar operación», «registrar dividendo», «registrar compra» o dicte una operación del estilo «16/11 degiro AAPL 16*0.27 = 4.32$ - 0.65$ ret. cambio 1,1026».
---

# Añadir un movimiento a investsheet

Anota una operación en la aplicación de producción llamando directamente a la API. No hace falta leer `docs/api.md` ni la guía `GET /api/v1`: aquí está todo lo necesario. Recurre a la guía solo si la API responde con un error que indique que algo de lo de aquí ha cambiado.

## Acceso

- Base: `https://invest.jdmuriel.com/api/v1`.
- **No pongas cabecera de autorización**: el proxy de la sesión inyecta el token (secreto de red del entorno). Si responde 401, el entorno no tiene el secreto: díselo al usuario y para.
- Las escrituras llevan siempre `-H "Content-Type: application/json"` (sin ella, 403).
- Importes en unidades de su moneda (no céntimos), acciones en unidades. Números con punto decimal en el JSON.

## 1. Reunir los datos

Datos que se esperan: **tipo**, **fecha**, **cuenta**, **ticker**, **nº de acciones**, **importe** (o precio por acción), **retención** si la hay y **tipo de cambio** si la moneda no es EUR.

- Fecha sin año → el año en curso (si eso la deja en el futuro, el anterior).
- `16*0.27 = 4.32$` significa 16 acciones, 0,27 por acción, importe bruto 4,32 en USD. `$` = USD, `€` = EUR, `£` = GBP (pence: GBX si así lo dice el usuario).
- «ret.» o «retención» es la retención; «cambio» o «tipo de cambio» es el `fxRate`.
- Si falta algo **imprescindible** (tipo, cuenta, ticker, importe o precio, y el cambio en moneda distinta del euro), pregúntalo todo junto en un solo mensaje, con `AskUserQuestion` si encaja. No inventes el tipo de cambio: el del broker difiere del BCE.
- Lo que se pueda deducir no se pregunta: la moneda sale del valor (`GET /valores`) o de la última operación del mismo valor; el tipo es «dividendo» si el usuario dice dividendo o el formato es `acciones*dividendo`.

### Cartera

La API trabaja por cartera (`{cartera}` = id o nombre). Cuentas actuales:

| Cartera | Cuentas |
|---|---|
| 1 (Principal) | `ING`, `IBUSD`, `IBEUR`, `DEGIRO` |
| 2 | `MYINV`, `DEGIRO2`, `DEGIRO` |
| 3 | `MYINV`, `DEGIRO` |

Si no se nombra cartera, es la 1. Si la cuenta existe en varias (`DEGIRO`, `MYINV`) y el usuario no la ha dicho, mira qué cartera tiene el valor en esa cuenta: `GET /carteras/{id}/operaciones?valor=TICKER&cuenta=CUENTA&limite=1` en cada una. Si lo tiene una sola, es esa; si no, pregunta.

### Retenciones (regla del propietario)

- En las cuentas de brokers extranjeros (`DEGIRO`, `DEGIRO2`, `IBUSD`, `IBEUR`) la retención es **siempre en origen**: va en `whtSource`, nunca en `whtDest`.
- En `ING` y `MYINV` puede haber las dos: la del país del valor en `whtSource` y la española (19 %) en `whtDest`. Si el usuario da una sola cifra para un valor extranjero en estas cuentas, pregunta cómo se reparte, o mira la última operación del valor para ver cómo se hizo.

### Plantilla de la última operación

Para comprobar o completar datos, consulta la última operación del mismo tipo y valor:

```bash
curl -s "https://invest.jdmuriel.com/api/v1/carteras/1/operaciones?valor=AAPL&tipo=DIVIDENDOS&cuenta=DEGIRO&limite=1"
```

Devuelve `quantity`, `price`, `currency`, `fxRate` y los importes en euros. Sirve para detectar erratas (otro nº de acciones, otro dividendo por acción, un cambio muy distinto): si algo no cuadra, avísalo antes de guardar.

## 2. Cuerpo de la petición

`POST /carteras/{cartera}/operaciones` con `type`, `date` (`AAAA-MM-DD`) y los campos del tipo. `account` es el código de la cuenta, `security` el ticker. `amount` y las retenciones van en la moneda de la operación (`currency`); `fees` y `cashTotal`, en la de la cuenta. `fxRate` son **unidades de la moneda por euro** (p. ej. 1.10 USD por EUR); solo si `currency` no es EUR. Si falta `amount` se calcula como `quantity × price`; si se da `cashTotal` (lo abonado o cargado en la cuenta), los gastos son la diferencia. Campos marcados *(opc.)* se pueden omitir.

| `type` | Campos |
|---|---|
| `DIVIDENDOS` | `account`, `security`, `quantity` (opc.), `price` (opc., dividendo por acción), `currency`, `fxRate`, `amount` (bruto), `whtSource`, `whtDest`, `fees`, `cashTotal` (opc., neto abonado) |
| `COMPRA` | `account`, `security`, `quantity`, `price`, `currency`, `fxRate`, `amount`, `fees`, `cashTotal` (opc., total cargado) |
| `VENTA` | `account`, `security`, `quantity`, `price`, `currency`, `fxRate`, `amount`, `fees`, `cashTotal` (opc., neto abonado) |
| `APORTACION` / `RETIRADA` | `account`, `amount` |
| `INTERESES` | `account`, `amount` (bruto), `whtDest` (retención), `fees` |
| `GASTOS` | `account`, `amount` |
| `TRASPASO` | `account` (origen), `toAccount` (destino), `amount`, `fees` |
| `CAMBIO` | `account` (origen), `toAccount` (destino), `amount` (sale), `amountTo` (entra), `fees` (incluidos, en euros) |

Opciones: `"dryRun": true` valida sin guardar; `"confirm": true` acepta avisos (409); `"createSecurity": true` da de alta un ticker nuevo (pregunta antes de usarlo: puede ser una errata). Para otros tipos (derechos, *split*, *spin-off*, opciones…) consulta la guía `GET /api/v1`, clave `types`.

Ejemplo (datos inventados):

```json
{ "type": "DIVIDENDOS", "date": "2026-03-10", "account": "DEGIRO", "security": "ACME", "quantity": 10, "price": 0.5, "currency": "USD", "fxRate": 1.08, "amount": 5, "whtSource": 0.75 }
```

## 3. Probar y guardar

1. Envía primero con `"dryRun": true`:

   ```bash
   curl -s -w '\nHTTP %{http_code}\n' -X POST "https://invest.jdmuriel.com/api/v1/carteras/1/operaciones" \
     -H "Content-Type: application/json" -d '{ ...campos..., "dryRun": true }'
   ```

2. Según la respuesta:
   - `200`: comprueba que la descripción, el bruto y el neto cuadran con lo dictado (bruto − retenciones − gastos, pasado a euros con el cambio). Si cuadra, **repite la petición sin `dryRun`** para guardarla; no hace falta pedir permiso, el usuario ya ha pedido anotarla. Si no cuadra o la plantilla de la última operación delata una posible errata, enséñalo y pregunta antes de guardar.
   - `422` con `errors`: corrige lo que se pueda deducir y vuelve a probar; si no, pregunta al usuario.
   - `409` con `warnings` (p. ej. saldo negativo): enséñaselos y guarda con `"confirm": true` solo si el usuario lo acepta.
   - `404`: cartera u operación que no existe; revisa el id de la cartera.
3. La respuesta de guardado (`201`) trae `id`, `description`, `cash` y `balancesAfter`.

## 4. Informar

En pocas líneas: cartera, id de la operación, descripción, fecha y cuenta; bruto y retención en la moneda de origen con el cambio; bruto, retención y neto en euros. No repitas el saldo de la cuenta salvo que lo pidan.

Para corregir una operación recién anotada: `GET /operaciones/{id}` (sus `fields`), cambia lo necesario y `PUT /operaciones/{id}` con **todos** los campos y `Content-Type: application/json`. Para borrarla: `DELETE /operaciones/{id}?confirm=1` con la misma cabecera, solo si el usuario lo pide.

## Privacidad

Los importes reales no se escriben en el repositorio (ni en este fichero, ni en `docs/`, ni en mensajes de *commit*). Si al anotar sale algo que conviene documentar, se describe sin cifras.
