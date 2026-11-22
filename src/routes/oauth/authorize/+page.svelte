<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Conectar con investsheet</h1>

<section class="consent">
	<p><strong>{data.client}</strong> pide acceso a investsheet como conector MCP.</p>
	<p>Podrá <strong>consultar y anotar, modificar o borrar operaciones</strong> en todas las carteras, en tu nombre.</p>
	<p>Al permitirlo volverás a <strong>{data.host}</strong>. Si no reconoces esa dirección o no acabas de añadir el conector, cancela.</p>
	<p>Puedes revocar el acceso cuando quieras en <a href="/ajustes/conectores">Ajustes → Conectores</a>.</p>
	<form method="POST">
		<button name="decision" value="permitir">Permitir</button>
		<button name="decision" value="cancelar">Cancelar</button>
	</form>
</section>

<style>
	.consent {
		max-width: 36rem;
	}
	form {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
</style>
