# Servidor MCP local

Servidor MCP para usar investsheet desde Claude Code: anotar, corregir y consultar operaciones, y sacar los dividendos cobrados por periodo con su gráfico. Es un proceso local (transporte stdio) que llama a la [API para asistentes](api.md) de producción; no añade nada al servidor ni al esquema.

## Arranque

Claude Code lo lanza solo según `.mcp.json` (en la raíz del repositorio) al empezar una sesión en esta carpeta; la primera vez pide aprobar el servidor del proyecto. Si se añade o cambia el fichero a mitad de sesión, hace falta una sesión nueva (o `/mcp` para reconectar). No necesita dependencias ni compilar: `node scripts/mcp.ts`.

- **En la nube de Claude Code** el token va como secreto de red del entorno para el host de la aplicación: el proxy lo inyecta y el servidor no lo ve. `.mcp.json` pone `NODE_USE_ENV_PROXY=1` para que `fetch` pase por ese proxy.
- **En local** hay que darle el token en `INVESTSHEET_TOKEN` (por ejemplo, en el `env` de una configuración propia, nunca en el repositorio). `INVESTSHEET_URL` cambia la base de la API (por defecto, la de producción; para el servidor de desarrollo, `http://localhost:5173/api/v1` con su propio `API_TOKEN`).

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `guia` | La guía de la API: carteras y cuentas, tipos de operación con sus campos, normas. |
| `valores` | Valores conocidos con moneda, retenciones y estado. |
| `estado_cartera` | Saldos, capital, posiciones y métricas por año a una fecha. |
| `buscar_operaciones` | Operaciones con filtros (fechas, tipo, valor, cuenta, texto). |
| `ver_operacion` | Una operación con sus campos y efectos. |
| `anotar_operacion` | Alta. **Sin `guardar: true` solo valida** y enseña el resultado (`dryRun` de la API). |
| `modificar_operacion` | Sustituye una operación (todos los campos); igual, sin `guardar` solo valida. |
| `borrar_operacion` | Borra; exige `confirmar: true`. |
| `dividendos` | Cobros por año, trimestre o mes (huecos a cero), con bruto, retenciones, gastos, neto, variación y acumulado; desglose por valor, cuenta, cartera o tipo; `cartera: "todas"`; `incluirDevoluciones` suma devoluciones de prima y ventas de derechos, como «Cobrado» en el cuadro. Con `grafico` dibuja además el SVG. |
| `grafico` | Gráfico SVG (barras, barras apiladas o líneas) con los datos que se le pasen. |

Los gráficos se guardan por defecto en `data/graficos/` (fuera del repositorio: llevan importes reales), con modo claro y oscuro y el valor de cada marca al pasar el ratón. Como mucho ocho series; en los desgloses, el resto va en «Otros», en gris.

## Código

- `src/lib/mcp/protocol.ts`: JSON-RPC de MCP (`initialize`, `tools/list`, `tools/call`, `ping`), sin dependencias e independiente del transporte.
- `src/lib/mcp/tools.ts`: las herramientas, con la API y el disco inyectados (`ToolContext`), para probarlas con una API falsa.
- `src/lib/mcp/dividends.ts`: agregación de cobros (pura). `src/lib/mcp/chart.ts`: dibujo SVG (puro).
- `scripts/mcp.ts`: transporte stdio, `fetch` a la API y escritura de los gráficos.
- La API devuelve como mucho 500 operaciones por consulta: `fetchOperations` las pide por años y, si un año no cabe, por meses.

## Pendiente

El conector remoto con OAuth para la aplicación de Claude y el móvil (tarea 1.19): las mismas herramientas de `tools.ts` servidas desde la aplicación por HTTP, llamando a `api.ts` directamente en lugar de por red.
