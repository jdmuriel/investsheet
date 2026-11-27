<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h1>Ajustes</h1>

<section>
	<h2>Datos</h2>
	<p>{data.portfolios} carteras, {data.operations} operaciones y {data.securities} valores.</p>
</section>

<section>
	<h2>Datos maestros</h2>
	<p><a href="/ajustes/cuentas">Cuentas</a> de cada cartera y <a href="/ajustes/valores">valores</a>: alta y edición.</p>
</section>

<section>
	<h2>Precios y tipos de cambio</h2>
	<p><a href="/precios">Precios y tipos de cambio</a>: estado de la hoja de precios y del BCE, último precio de cada valor y precio a mano.</p>
</section>

<section>
	<h2>Objetivos anuales</h2>
	<p><a href="/ajustes/objetivos">Objetivos</a> de cada cartera por año; su grado de consecución se ve junto a las métricas del listado de movimientos.</p>
</section>

<section>
	<h2>Exportación de validación</h2>
	<p>
		Libro de cálculo con el registro de cada cartera tal como lo calcula la aplicación, con las mismas columnas que la solapa <code>Log</code> de la hoja, para compararlos lado a lado.
		<a href="/ajustes/validacion" download>Descargar sin comparar</a>.
	</p>
	<p>Si adjuntas una copia de la hoja (descargada como .xlsx), el libro incluye además una solapa con las diferencias de más de un céntimo, por fecha y columna.</p>
	<form method="POST" action="/ajustes/validacion" enctype="multipart/form-data">
		<input type="file" name="referencia" accept=".xlsx" required aria-label="Copia de la hoja" />
		<label>Detallar diferencias desde <input type="date" name="desde" /></label>
		<button>Comparar y descargar</button>
	</form>
</section>

<section>
	<h2>Importar datos de la hoja</h2>
	<p>
		Completa la aplicación con lo que la hoja tiene además de las operaciones: objetivos del año, último precio y tipo de cambio, calendario de dividendos previstos, orden de los valores, histórico de cambios de dividendo y la selección mensual con sus revisiones. <strong>No pisa
		nada</strong>: solo rellena lo que falta, así que se puede repetir. Las operaciones no se tocan.
	</p>
	<form method="POST" action="?/hoja" enctype="multipart/form-data">
		<input type="file" name="hoja" accept=".xlsx" required aria-label="Copia de la hoja" />
		<label>Los precios de la hoja son del <input type="date" name="fecha" value={data.today} max={data.today} /></label>
		<button>Importar</button>
	</form>
	{#if form?.sheetError}
		<p class="error">{form.sheetError}</p>
	{/if}
	{#if form?.sheet}
		<p class="ok">
			Importado: {form.sheet.prices} precios, {form.sheet.fxRates} tipos de cambio, {form.sheet.schedules} calendarios de dividendos, {form.sheet.changes} cambios de dividendo, {form.sheet.goals} objetivos,
			el orden de {form.sheet.orders} carteras, {form.sheet.selection} valores en la selección y {form.sheet.reviews} revisiones mensuales.
			{#if form.sheet.created.length}Valores nuevos dados de alta desde la selección: {form.sheet.created.join(', ')}.{/if}
			{#if form.sheet.unknown.length}Tickers de la hoja sin valor en la aplicación: {form.sheet.unknown.join(', ')}.{/if}
		</p>
	{/if}
</section>

<section>
	<h2>Precios</h2>
	<p><a href="/precios">Precios y tipos de cambio</a>: estado de las fuentes y corrección de un precio a mano.</p>
</section>

<section>
	<h2>Conectores</h2>
	<p><a href="/ajustes/conectores">Conector MCP para Claude</a>: dirección del servidor y accesos concedidos, que se pueden revocar.</p>
</section>

<section>
	<h2>Copia de seguridad</h2>
	<p><a href="/ajustes/copia" download>Descargar una copia de la base de datos</a></p>
</section>

<section>
	<h2>Restaurar</h2>
	<p>Sustituye todos los datos por los de un fichero de copia. Antes se guarda en el servidor una copia de los datos actuales.</p>
	<form method="POST" action="?/restaurar" enctype="multipart/form-data">
		<input type="file" name="fichero" accept=".db" required />
		<button>Restaurar</button>
	</form>
	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}
	{#if form?.restored}
		<p class="ok">
			Restaurado: {form.restored.portfolios} carteras y {form.restored.operations} operaciones. La base anterior se guardó como
			<code>{form.restored.previous}</code>.
		</p>
	{/if}
</section>

<style>
	h1 {
		font-size: 1.3rem;
	}
	h2 {
		font-size: 1rem;
		margin-bottom: 0.2rem;
	}
	section {
		max-width: 44rem;
		margin-bottom: 1.5rem;
	}
	form {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}
	button,
	input[type='date'] {
		font: inherit;
		padding: 0.3rem 0.8rem;
	}
	label {
		color: var(--muted);
	}
	.error {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>
