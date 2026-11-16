# API para asistentes

La aplicación expone una API JSON en `/api/v1` para que un asistente (o un script) pueda consultar datos y anotar, cambiar o borrar operaciones. Escribe por la misma vía que el formulario: mismas validaciones, mismo registro de auditoría, y la operación queda marcada con origen `api`.

## Acceso

- Cabecera `Authorization: Bearer <token>`. El token es el secreto `API_TOKEN` de Fly; debe tener al menos 32 caracteres. Sin ese secreto la API responde 503.
- La API no acepta la sesión del navegador, y el token no da acceso a las pantallas.
- Las peticiones de escritura (`POST`, `PUT` y también `DELETE`) deben llevar `Content-Type: application/json`; sin ella el servidor responde 403.
- El token da acceso completo de lectura y escritura a todas las carteras. Para revocarlo basta cambiar el secreto.

Para activarla o cambiar el token:

```bash
fly secrets set API_TOKEN="$(openssl rand -hex 32)" --app investsheet
```

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /api/v1` | Guía: carteras con sus cuentas, tipos de operación con sus campos y normas de escritura. **Un asistente debe empezar por aquí.** |
| `GET /api/v1/valores` | Valores conocidos, con moneda y porcentajes de retención. |
| `GET /api/v1/carteras/{cartera}/estado?fecha=AAAA-MM-DD` | Saldos por cuenta, capital, resultado del año, posiciones (acciones, coste, coste reducido, precio medio) y métricas anuales, a una fecha o al final del registro. |
| `GET /api/v1/carteras/{cartera}/operaciones` | Operaciones filtradas por `desde`, `hasta`, `tipo`, `valor`, `cuenta` y `texto`; `limite` (50 por defecto, 500 como máximo) devuelve las más recientes. |
| `POST /api/v1/carteras/{cartera}/operaciones` | Alta de una operación. |
| `GET /api/v1/operaciones/{id}` | Una operación, con los campos tecleados (`fields`) y sus efectos. |
| `PUT /api/v1/operaciones/{id}` | Sustituye una operación; se envían todos sus campos (los de `fields`, cambiando lo que haga falta). |
| `DELETE /api/v1/operaciones/{id}?confirm=1` | Borra una operación. |

`{cartera}` es el identificador o el nombre. Los importes van en unidades de su moneda y las acciones en unidades.

## Escritura

El cuerpo es un objeto JSON con `type`, `date` y los campos de ese tipo, los mismos que pide el formulario (la guía los lista). Las cuentas se indican por su código y los valores por su ticker.

```json
{ "type": "DIVIDENDOS", "date": "2025-06-01", "account": "BANCO", "security": "ACME", "quantity": 100, "price": 0.5, "whtDest": 9.5 }
```

Además de los campos admite:

- `"dryRun": true` — valida y devuelve descripción, movimientos de efectivo, saldo resultante e importes en euros **sin guardar nada**. Sirve para enseñar la operación antes de anotarla.
- `"confirm": true` — acepta los avisos (por ejemplo, una cuenta que queda en negativo).
- `"createSecurity": true` — da de alta el ticker si no existe.
- `"keepEffects": true` — en operaciones importadas de la hoja antigua, cambia solo fecha, descripción y notas.

Respuestas: `201` o `200` con `saved`, `id`, descripción y saldos resultantes; `422` con `errors` si la operación no es válida (no se guarda nada); `409` con `warnings` si necesita `confirm`; `401` sin token válido; `404` si no existe.

## Uso desde una sesión de Claude Code

El token se guarda como secreto de red del entorno para el host de la aplicación; el asistente no llega a verlo. Flujo recomendado al pedir «anota esta operación»: leer la guía, enviar la operación con `dryRun`, enseñar el resultado y, con el visto bueno, repetirla sin `dryRun`.

## Pendiente

Servidor MCP con OAuth sobre esta misma lógica, para usarlo como conector desde la aplicación de Claude (tarea 1.19 del plan).
