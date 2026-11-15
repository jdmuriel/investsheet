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
	button {
		font: inherit;
		padding: 0.3rem 0.8rem;
	}
	.error {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>
