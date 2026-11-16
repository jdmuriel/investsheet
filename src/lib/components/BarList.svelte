<script lang="ts">
	import { eur, pct } from '#lib/format.ts';

	interface Props {
		/** Importes en céntimos de euro; `share` es el peso sobre el total, si se quiere mostrar. */
		items: { label: string; amount: number; share?: number; note?: string }[];
		caption: string;
	}
	let { items, caption }: Props = $props();
	const max = $derived(Math.max(1, ...items.map((i) => Math.abs(i.amount))));
</script>

<!-- Lista de barras: una magnitud por fila, con su cifra al lado (la tabla y el gráfico son lo mismo). -->
<table class="bars">
	<caption>{caption}</caption>
	<tbody>
		{#each items as item (item.label)}
			<tr title={item.note ?? `${item.label}: ${eur(item.amount)} €${item.share == null ? '' : ` (${pct(item.share)})`}`}>
				<th scope="row">{item.label}</th>
				<td class="track"><span class="bar" style="width: {(Math.abs(item.amount) / max) * 100}%"></span></td>
				<td class="n">{eur(item.amount)} €</td>
				{#if item.share != null}<td class="n share">{pct(item.share)}</td>{/if}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.bars {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	caption {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	th,
	td {
		padding: 0.2rem 0.4rem;
		white-space: nowrap;
		font-weight: 400;
	}
	th {
		text-align: left;
		max-width: 11rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.track {
		width: 100%;
		min-width: 4rem;
	}
	.bar {
		display: block;
		height: 10px;
		min-width: 2px;
		border-radius: 0 4px 4px 0;
		background: var(--accent);
	}
	.n {
		text-align: right;
	}
	.share {
		color: var(--muted);
	}
	tr:hover th,
	tr:hover td {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
</style>
