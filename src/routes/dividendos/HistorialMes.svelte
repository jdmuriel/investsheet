<script lang="ts">
	import { page } from '$app/state';
	import { MONTH_NAMES } from '#lib/engine/dividends.ts';
	import { addMonths, type CompareRow } from '#lib/engine/history.ts';
	import { eur, num, pct, price } from '#lib/format.ts';
	import { link } from './link.ts';
	import type { PageData } from './$types';

	/**
	 * Un mes valor a valor frente al mismo mes del año anterior, con la causa de cada diferencia y el texto
	 * resumen para copiar.
	 */
	let { data }: { data: Extract<PageData, { view: 'mes' }> } = $props();
	const name = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
	const field = $derived(data.measure === 'neto' ? 'net' : 'gross');
	const amount = (c: CompareRow['current']) => (c ? c[field] : 0);
	const signed = (v: number) => `${v > 0 ? '+' : ''}${eur(v)} €`;

	/** Un valor por fila. */
	const rows = $derived(data.annual.rows.map((a) => ({ id: a.securityId, ticker: a.ticker, current: a.current, annual: a as CompareRow | null })));

	function diff(r: CompareRow | null): string {
		if (!r) return '';
		if (r.cause === 'adelanta') return 'se adelanta';
		if (r.cause === 'atrasa') return 'se atrasa';
		return signed(r.diff);
	}
	function cause(r: CompareRow | null): string {
		if (!r) return '';
		switch (r.cause) {
			case 'nuevo':
				return 'nuevo';
			case 'vuelve':
				return 'vuelve a cobrar';
			case 'adelanta':
			case 'atrasa':
				return `cobro de ${name(r.movedFrom!)}`;
			case 'no-trimestral':
				return 'no paga cada trimestre';
			case 'vendido':
				return 'vendido';
			case 'pendiente':
				return 'pendiente de cobro';
			case 'sin-cobro':
				return 'sin cobro este mes';
			case 'sin-datos':
				return 'faltan acciones o dividendo por acción';
		}
		const parts: string[] = [];
		if (r.dividend) parts.push(`${r.dividend > 0 ? 'sube' : 'baja'} dividendo ${r.dividendChange! > 0 ? '+' : ''}${pct(r.dividendChange)}`);
		if (r.shares) parts.push(`${r.shares > 0 ? 'más' : 'menos'} acciones (${r.sharesChange! > 0 ? '+' : ''}${num(Math.round(r.sharesChange! * 1e4) / 1e4)})`);
		if (!parts.length) parts.push('sin cambios');
		if (r.parts && Math.abs(r.parts.fx) >= 100) parts.push(`divisa ${signed(r.parts.fx)}`);
		return parts.join(', ');
	}
	function detail(r: CompareRow | null): string | undefined {
		if (!r?.base) return undefined;
		const b = r.base;
		const before = `Antes: ${b.shares == null ? '?' : num(b.shares)} acciones × ${price(b.dps, b.currency)} = ${eur(b[field])} €`;
		if (!r.parts) return before;
		return `${before}\nAcciones ${signed(r.parts.shares)} · dividendo ${signed(r.parts.dividend)} · divisa y redondeo ${signed(r.parts.fx)}`;
	}
	const isMoved = (r: CompareRow | null) => r?.cause === 'adelanta' || r?.cause === 'atrasa';

	let copied = $state(false);
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<form method="GET" class="filters">
	<input type="hidden" name="cartera" value={data.portfolioId} />
	<input type="hidden" name="vista" value="historial" />
	<input type="hidden" name="ver" value="mes" />
	<a href={link(page.url, { mes: addMonths(data.month, -1) })} aria-label="Mes anterior">← {MONTH_NAMES[Number(addMonths(data.month, -1).slice(5, 7)) - 1]}</a>
	<label>
		Mes
		<input type="month" name="mes" value={data.month} min={data.firstMonth} max={data.lastMonth} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
	</label>
	<a href={link(page.url, { mes: addMonths(data.month, 1) })} aria-label="Mes siguiente">{MONTH_NAMES[Number(addMonths(data.month, 1).slice(5, 7)) - 1]} →</a>
</form>

<div class="text">
	<div class="head">
		<strong>Frente al año anterior</strong>
		<span class="muted">{name(data.annual.base)}: {eur(data.annual.baseTotal)} € → {eur(data.annual.total)} €</span>
		{#if data.annual.baseTotal}<span class:neg={data.annual.total < data.annual.baseTotal}>{signed(data.annual.total - data.annual.baseTotal)} ({data.annual.total >= data.annual.baseTotal ? '+' : ''}{pct((data.annual.total - data.annual.baseTotal) / data.annual.baseTotal)})</span>{/if}
		<button type="button" class="copy" onclick={() => copy(data.annualText)}>{copied ? 'copiado' : 'copiar'}</button>
	</div>
	<p>{data.annualText}</p>
</div>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th class="l first" rowspan="2">Valor</th>
				<th colspan="3" class="group">{name(data.month)}</th>
				<th colspan="3" class="group">{name(data.annual.base)}</th>
			</tr>
			<tr>
				<th>Acciones</th>
				<th>Por acción</th>
				<th>Importe</th>
				<th>Importe</th>
				<th>Diferencia</th>
				<th class="l">Causa</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.id)}
				<tr>
					<td class="l first"><a href={link(page.url, { ver: 'valor', valor: r.id, mes: null })} title="Todos los cobros de {r.ticker}">{r.ticker}</a></td>
					<td>{r.current?.shares == null ? '' : num(r.current.shares)}</td>
					<td>{r.current ? price(r.current.dps, r.current.currency) : ''}</td>
					<td>{r.current ? eur(amount(r.current)) : ''}</td>
					<td class="sep">{r.annual?.base ? eur(amount(r.annual.base)) : ''}</td>
					<td class:neg={!isMoved(r.annual) && (r.annual?.diff ?? 0) < 0} class:moved={isMoved(r.annual)} title={r.annual ? `${signed(r.annual.diff)}` : undefined}>{diff(r.annual)}</td>
					<td class="l cause" title={detail(r.annual)}>{cause(r.annual)}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr>
				<td class="l first">Total</td>
				<td></td>
				<td></td>
				<td>{eur(data.annual.total)}</td>
				<td class="sep">{eur(data.annual.baseTotal)}</td>
				<td class:neg={data.annual.total < data.annual.baseTotal}>{signed(data.annual.total - data.annual.baseTotal)}</td>
				<td></td>
			</tr>
		</tfoot>
	</table>
</div>
<p class="muted">
	Importes {data.measure === 'neto' ? 'netos' : 'brutos'} en €; lo cobrado por acción, en la moneda del valor. La causa compara acciones y dividendo por acción en su moneda (ajustados por splits); lo que no explican es el efecto del tipo de cambio. Pasa el ratón por la causa para ver el reparto.
</p>

<style>
	.text {
		margin-bottom: 1rem;
		max-width: 60rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}
	.text .head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
	}
	.text p {
		margin: 0.4rem 0 0;
		line-height: 1.45;
	}
	.copy {
		margin-left: auto;
		font: inherit;
		font-size: 12px;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--soft);
		color: var(--fg);
		cursor: pointer;
	}
	th.group {
		text-align: center;
		border-left: 1px solid var(--line);
	}
	thead tr:nth-child(2) th {
		top: 1.6rem;
	}
	.sep {
		border-left: 1px solid var(--line);
	}
	.cause {
		color: var(--muted);
		font-size: 13px;
	}
	.first {
		position: sticky;
		left: 0;
		background: var(--bg);
		z-index: 1;
	}
	thead .first,
	tfoot .first {
		background: var(--soft);
		z-index: 2;
	}
	.moved {
		color: var(--accent);
	}
</style>
