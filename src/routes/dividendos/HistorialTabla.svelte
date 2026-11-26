<script lang="ts">
	import { page } from '$app/state';
	import { MONTH_SHORT } from '#lib/engine/dividends.ts';
	import type { Cell } from '#lib/engine/history.ts';
	import { eur, price } from '#lib/format.ts';
	import { link } from './link.ts';
	import type { PageData } from './$types';

	/** Tabla completa, como la de `Control cartera` desde la fila 62: meses en filas y valores en columnas, con el total de cada año. */
	let { data }: { data: Extract<PageData, { view: 'tabla' }> } = $props();
	const money = $derived(data.measure === 'neto' ? 'net' : 'gross');
	const show = (c: Cell | null) => (!c ? '' : data.measure === 'dpa' ? price(c.dps) : eur(c[money]));
	const sum = (cells: (Cell | null)[]) => cells.reduce((a, c) => a + (c ? c[money] : 0), 0);

	/** Filas agrupadas por año, con una fila de total al final de cada uno. */
	const groups = $derived.by(() => {
		const out: { year: string; rows: typeof data.table; totals: number[] }[] = [];
		for (const r of data.table) {
			const year = r.month.slice(0, 4);
			let g = out.at(-1);
			if (g?.year !== year) out.push((g = { year, rows: [], totals: new Array(data.securities.length).fill(0) }));
			g.rows.push(r);
			r.cells.forEach((c, i) => (g.totals[i] += c ? c[money] : 0));
		}
		return out;
	});
	let collapsed = $state<Record<string, boolean>>({});
</script>

<div class="scroll tall">
	<table>
		<thead>
			<tr>
				<th class="l first">Mes</th>
				{#if data.measure !== 'dpa'}<th>Total</th>{/if}
				{#each data.securities as s (s.id)}<th class:gone={!s.held}><a href={link(page.url, { ver: 'valor', valor: s.id })}>{s.ticker}</a></th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each groups as g (g.year)}
				{#if !collapsed[g.year]}
					{#each g.rows as r (r.month)}
						<tr>
							<td class="l first"><a href={link(page.url, { ver: 'mes', mes: r.month })}>{MONTH_SHORT[Number(r.month.slice(5, 7)) - 1]} {g.year}</a></td>
							{#if data.measure !== 'dpa'}<td class="total">{eur(sum(r.cells))}</td>{/if}
							{#each r.cells as c, i (i)}<td>{show(c)}</td>{/each}
						</tr>
					{/each}
				{/if}
				<tr class="year">
					<td class="l first">
						<button type="button" class="link" aria-expanded={!collapsed[g.year]} onclick={() => (collapsed[g.year] = !collapsed[g.year])}>{collapsed[g.year] ? '▸' : '▾'} {g.year}</button>
					</td>
					{#if data.measure !== 'dpa'}<td class="total">{eur(g.totals.reduce((a, b) => a + b, 0))}</td>{/if}
					{#each g.totals as t, i (i)}<td>{data.measure === 'dpa' ? '' : eur(t, true)}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted">
	{data.measure === 'dpa' ? 'Lo cobrado por acción en cada mes, en la moneda del valor.' : `Importes ${data.measure === 'neto' ? 'netos' : 'brutos'} en €.`} Los valores sin posición hoy van en gris. Pulsa un año para plegarlo.
</p>

<style>
	.tall {
		max-height: 75vh;
	}
	.first {
		position: sticky;
		left: 0;
		background: var(--bg);
		z-index: 1;
	}
	thead .first {
		background: var(--soft);
		z-index: 2;
	}
	th a {
		color: inherit;
	}
	th.gone a {
		color: var(--muted);
		font-weight: normal;
	}
	.total {
		font-weight: 600;
	}
	tr.year td {
		background: var(--soft);
		font-weight: 600;
	}
	tr.year button.link {
		color: var(--fg);
		text-decoration: none;
		font-weight: 600;
	}
</style>
