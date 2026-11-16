<script lang="ts">
	import { eur } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const blank = { id: null, code: '', name: '', broker: '', currency: 'EUR', sortOrder: '', closed: 0, movements: 0, balance: 0 };
	/** Valor de un campo: lo tecleado si el envío de esa fila se rechazó, o lo guardado. */
	const value = (row: { id: number | null }, key: string) => String((form?.raw && form.id === row.id ? form.raw[key] : (row as Record<string, unknown>)[key]) ?? '');
</script>

<header class="page">
	<h1>Cuentas</h1>
	<form method="GET">
		<select name="cartera" aria-label="Cartera" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			{#each data.portfolios as p (p.id)}
				<option value={p.id} selected={p.id === data.portfolioId}>{p.name}</option>
			{/each}
		</select>
	</form>
	<a href="/ajustes">Volver a Ajustes</a>
</header>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{:else if form?.savedId}
	<p class="ok">Cuenta guardada.</p>
{/if}

<p class="note">
	El código es el nombre corto que aparece en el listado y en la API. Una cuenta cerrada deja de ofrecerse al dar de alta movimientos, pero conserva su historial. La moneda no se puede cambiar cuando ya hay
	movimientos.
</p>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th>Código</th>
				<th>Nombre</th>
				<th>Broker</th>
				<th>Moneda</th>
				<th>Orden</th>
				<th>Cerrada</th>
				<th class="r">Movimientos</th>
				<th class="r">Saldo</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each [...data.accounts, blank] as a (a.id)}
				{@const f = `cuenta-${a.id ?? 'nueva'}`}
				<tr class:new={a.id == null} class:closed={a.closed}>
					<td>
						<form id={f} method="POST" action="?/guardar&cartera={data.portfolioId}"></form>
						{#if a.id != null}<input type="hidden" name="id" value={a.id} form={f} />{/if}
						<input name="code" form={f} value={value(a, 'code')} size="9" maxlength="12" required placeholder={a.id == null ? 'Nueva cuenta' : ''} autocapitalize="characters" aria-label="Código" />
					</td>
					<td><input name="name" form={f} value={value(a, 'name')} size="18" aria-label="Nombre" /></td>
					<td><input name="broker" form={f} value={value(a, 'broker')} size="12" aria-label="Broker" /></td>
					<td>
						<select name="currency" form={f} aria-label="Moneda" value={value(a, 'currency')}>
							{#each data.currencies as c (c)}<option>{c}</option>{/each}
						</select>
					</td>
					<td><input name="sortOrder" form={f} value={value(a, 'sortOrder')} size="3" inputmode="numeric" aria-label="Orden" /></td>
					<td class="c">
						{#if a.id != null}<input type="checkbox" name="closed" value="1" form={f} checked={form?.raw && form.id === a.id ? form.raw.closed === '1' : Boolean(a.closed)} aria-label="Cerrada" />{/if}
					</td>
					<td class="r">{a.id == null ? '' : a.movements}</td>
					<td class="r" class:neg={a.balance < 0}>{a.id == null ? '' : `${eur(a.balance)} ${a.currency}`}</td>
					<td><button form={f}>{a.id == null ? 'Añadir' : 'Guardar'}</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.page {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	.note {
		max-width: 50rem;
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.3rem 0.5rem;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		color: var(--muted);
	}
	.r {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.c {
		text-align: center;
	}
	tr.closed input:not([type='checkbox']),
	tr.closed td {
		color: var(--muted);
	}
	tr.new td {
		border-bottom: none;
		padding-top: 0.8rem;
	}
	input,
	select,
	button {
		font: inherit;
		padding: 0.25rem 0.4rem;
	}
	input:not([type='checkbox']),
	select {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	.errors,
	.neg {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>
