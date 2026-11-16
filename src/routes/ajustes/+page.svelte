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
