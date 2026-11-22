<script lang="ts">
	import { dateTime } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// SQLite guarda la hora en UTC como «AAAA-MM-DD HH:MM:SS».
	const when = (sql: string | null) => (sql ? dateTime(`${sql.replace(' ', 'T')}Z`) : '—');
</script>

<h1>Conectores</h1>

<section>
	<p>
		Servidor MCP para Claude: <code>{data.endpoint}</code>. Se añade en Claude como conector personalizado con esa dirección; al conectarlo, Claude te trae aquí para que le des acceso.
	</p>
</section>

<section>
	<h2>Accesos concedidos</h2>
	{#if data.grants.length === 0}
		<p>Ninguno.</p>
	{:else}
		<table>
			<thead><tr><th>Cliente</th><th>Vuelve a</th><th>Concedido</th><th>Último uso</th><th></th></tr></thead>
			<tbody>
				{#each data.grants as g (g.id)}
					<tr>
						<td>{g.client}</td>
						<td>{g.redirectHosts}</td>
						<td>{when(g.createdAt)}</td>
						<td>{when(g.lastUsedAt)}</td>
						<td>
							<form method="POST" action="?/revocar">
								<input type="hidden" name="id" value={g.id} />
								<button>Revocar</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.revoked}<p class="ok">Acceso revocado.</p>{/if}
</section>

<style>
	table {
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.8rem 0.3rem 0;
	}
	.error {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>
