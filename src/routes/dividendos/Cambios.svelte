<script lang="ts">
	import { date, eur, num, pct, price, symbol } from '#lib/format.ts';
	import type { PageData } from './$types';

	/** Solapa «Cambios de dividendo»: los anotados en un año con su efecto en la cartera (RF-17, RF-18). */
	let { data, deleted = false }: { data: Extract<PageData, { tab: 'cambios' }>; deleted?: boolean } = $props();
	const total = $derived(data.years.find((y) => y.year === data.year));
	/** Frase resumen del cambio, como la que se anotaba en la hoja. */
	function phrase(c: (typeof data.changes)[number]): string {
		const verb = c.newAnnual > c.oldAnnual ? 'sube' : 'baja';
		const change = c.pct == null ? '' : `, ${c.pct > 0 ? '+' : ''}${pct(c.pct)}`;
		const own = c.shares > 0 ? ` Con ${num(c.shares)} acciones, el ingreso anual pasa de ${eur(c.beforeEur)} a ${eur(c.afterEur)} €.` : '';
		return `${c.ticker} ${verb} de ${price(c.oldAnnual)} a ${price(c.newAnnual)} ${symbol(c.currency)}${change}.${own}`;
	}
</script>

{#if deleted}<p class="ok">Cambio de dividendo borrado. El calendario no se ha tocado.</p>{/if}

<section>
	<form method="GET" class="filters">
		<input type="hidden" name="cartera" value={data.portfolioId} />
		<input type="hidden" name="vista" value="cambios" />
		<label>
			Año
			<select name="anio" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.years as y (y.year)}<option value={y.year} selected={y.year === data.year}>{y.year} ({y.count})</option>{/each}
			</select>
		</label>
		{#if total}
			<span>
				Efecto en el ingreso anual de esta cartera:
				<strong class:neg={total.annualEur < 0}>{total.annualEur > 0 ? '+' : ''}{eur(total.annualEur)} €</strong>
			</span>
		{/if}
	</form>
	{#if data.changes.length}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th class="l">Fecha</th>
						<th class="l">Valor</th>
						<th>Antes</th>
						<th>Después</th>
						<th>Variación</th>
						<th>Acciones</th>
						<th>Efecto anual</th>
						<th class="l">Resumen</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.changes as c (c.id)}
						<tr class:none={c.shares === 0}>
							<td class="l">{date(c.date)}</td>
							<td class="l"><a href="/dividendos/{c.securityId}">{c.ticker}</a></td>
							<td>{price(c.oldAnnual, c.currency)}</td>
							<td>{price(c.newAnnual, c.currency)}</td>
							<td class:neg={(c.pct ?? 0) < 0}>{c.pct == null ? 'nuevo' : `${c.pct > 0 ? '+' : ''}${pct(c.pct)}`}</td>
							<td>{c.shares ? num(c.shares) : ''}</td>
							<td class:neg={c.annualEur < 0}>{c.shares ? `${c.annualEur > 0 ? '+' : ''}${eur(c.annualEur)} €` : ''}</td>
							<td class="l wrap">
								{phrase(c)}
								{#if c.note && !/^\S+ (sube|baja) de /i.test(c.note)}<span class="muted">{c.note}</span>{/if}
								{#if c.url}<a href={c.url} target="_blank" rel="noreferrer">fuente</a>{/if}
							</td>
							<td>
								<form method="POST" action="?/borrar&cartera={data.portfolioId}&vista=cambios&anio={data.year}" onsubmit={(e) => confirm(`¿Borrar el cambio de ${c.ticker} del ${date(c.date)}?`) || e.preventDefault()}>
									<input type="hidden" name="id" value={c.id} />
									<button class="link">Borrar</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="muted">No hay cambios de dividendo anotados en {data.year}.</p>
	{/if}
	<p class="muted">Para anotar un cambio, abre el valor en la solapa «Calendario previsto»: una sola acción actualiza el calendario y deja constancia aquí.</p>
</section>
