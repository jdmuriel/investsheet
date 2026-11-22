# Servidor MCP

La aplicación sirve un servidor MCP en **`https://invest.jdmuriel.com/mcp`** para usarla desde Claude (web, escritorio y móvil) como conector personalizado, y desde Claude Code: anotar, corregir y consultar operaciones, y sacar los dividendos cobrados por periodo para dibujarlos. Las herramientas llaman dentro del proceso a la misma lógica que la [API para asistentes](api.md), con sus validaciones y su auditoría (origen `api`).

## Conectarlo

- **Claude (web, escritorio, móvil)**: Ajustes → Conectores → «Añadir conector personalizado», con la dirección `https://invest.jdmuriel.com/mcp` y sin ID ni secreto de cliente. Claude abre la aplicación: se inicia sesión con Google (si no había sesión) y se pulsa «Permitir». Desde ese momento el conector está disponible también en el móvil.
- **Claude Code**: `.mcp.json` del repositorio ya lo declara (`type: http`). En la nube, el proxy de la sesión añade el `API_TOKEN` (secreto de red del entorno), que `/mcp` también acepta. En local, Claude Code hace el mismo flujo OAuth abriendo el navegador (`/mcp` → autenticar).
- Los accesos concedidos se ven y se revocan en **Ajustes → Conectores** (`/ajustes/conectores`). Revocar uno invalida al momento sus tokens.

## Herramientas

Nombres y parámetros en inglés; descripciones en español.

| Herramienta | Qué hace |
|---|---|
| `get_guide` | Carteras y cuentas, tipos de operación con sus campos, normas de escritura. |
| `list_securities` | Valores conocidos con moneda, retenciones y estado. |
| `get_portfolio_state` | Saldos, capital, posiciones y métricas por año a una fecha. |
| `search_operations` | Operaciones con filtros (`from`, `to`, `type`, `security`, `account`, `text`, `limit`). |
| `get_operation` | Una operación con sus campos (`fields`) y efectos. |
| `add_operation` | Alta. **Sin `save: true` solo valida** y enseña el resultado (el `dryRun` de la API). |
| `update_operation` | Sustituye una operación (todos los campos); sin `save`, solo valida. |
| `delete_operation` | Borra; exige `confirm: true`. |
| `get_dividends` | Cobros por `year`, `quarter` o `month` (huecos a cero) con bruto, retenciones, gastos, neto, variación (`changePct`) y acumulado; desglose por `security`, `account`, `portfolio` o `type` (como mucho `maxGroups`, el resto en «Otros»); `portfolio: "all"`; `includeReturns` suma devoluciones de prima y ventas de derechos, como «Cobrado» en el cuadro. |

Los gráficos los dibuja quien llama (Claude) con los datos de `get_dividends`.

## Autorización

La aplicación es su propio servidor de autorización OAuth 2.1, para un solo usuario (el de `ALLOWED_EMAIL`):

| Ruta | Qué es |
|---|---|
| `/.well-known/oauth-protected-resource` (también con `/mcp` al final) | Metadatos del recurso protegido (RFC 9728): recurso `…/mcp` y su servidor de autorización. |
| `/.well-known/oauth-authorization-server` | Metadatos del servidor de autorización (RFC 8414). |
| `/oauth/register` | Registro dinámico de clientes (RFC 7591). Solo clientes públicos y solo con vuelta a `https://claude.ai/…`, `https://claude.com/…` o al bucle local (`http://localhost`, `127.0.0.1`; el puerto no cuenta). `MCP_REDIRECT_HOSTS` añade hosts. Los clientes que no llegan a autorizarse se borran al día. |
| `/oauth/authorize` | Pide la sesión del propietario y su consentimiento, que enseña el host al que se vuelve. PKCE S256 obligatorio; `resource`, si viene, debe ser `…/mcp`. |
| `/oauth/token` | Canje del código (un solo uso, diez minutos) y refresco. Acceso de una hora; refresco de 90 días que rota en cada uso. |

- `/mcp` sin token válido responde 401 con `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, que es lo que arranca el flujo en Claude.
- Códigos y tokens se guardan solo como hash SHA-256 (migración 10: `oauth_client`, `oauth_code`, `oauth_grant`, `oauth_token`).
- **CSRF**: el canje de tokens llega como formulario desde el servidor de Claude, sin cabecera `Origin`, y SvelteKit lo rechazaría. Por eso su comprobación está desactivada (`csrf.trustedOrigins: ['*']` en `vite.config.ts`) y `hooks.server.ts` aplica la misma regla (`crossSiteForbidden`) a todo salvo `/oauth/register` y `/oauth/token`.
- Tras iniciar sesión se vuelve a la página pedida (`/auth/login?volver=`, solo rutas internas), para que el flujo siga en la autorización.

## Transporte

Streamable HTTP sin sesiones: cada `POST /mcp` lleva un mensaje JSON-RPC (o un lote) y se responde con `application/json`; si solo había notificaciones, 202 sin cuerpo. `GET` y `DELETE` dan 405 (no hay flujo SSE ni sesiones). Versiones del protocolo: 2025-11-25, 2025-06-18 y 2025-03-26; una cabecera `MCP-Protocol-Version` con otra da 400.

## Código

- `src/lib/mcp/protocol.ts`: JSON-RPC de MCP (`initialize`, `tools/list`, `tools/call`, `ping`).
- `src/lib/mcp/tools.ts`: las herramientas, sobre un `Backend` inyectado; `src/lib/mcp/dividends.ts`: agregación de cobros (pura).
- `src/lib/server/mcp.ts`: el `Backend` con las funciones de `api.ts` y el transporte; ruta en `src/routes/mcp/+server.ts`.
- `src/lib/server/oauth.ts`: el servidor de autorización; rutas en `src/routes/oauth/` y `src/routes/.well-known/`.

Referencias: documentación de Claude sobre [autenticación de conectores](https://claude.com/docs/connectors/building/authentication) y [conectores personalizados](https://claude.com/docs/connectors/custom/remote-mcp).
