<script lang="ts">
	import { parseDecimal } from '#lib/engine/form.ts';
	import { date, eur } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Saldos tecleados, por cuenta; se conservan si el envío se rechaza y se vacían al guardar.
	let real = $state<Record<number, string>>({});
	$effect(() => {
		real = Object.fromEntries(data.accounts.map((a) => [a.id, form?.raw?.[`real-${a.id}`] ?? '']));
	});
	/** Diferencia en céntimos entre lo tecleado y lo calculado; `null` si no hay nada (válido) tecleado. */
	function difference(accountId: number, computed: number): number | null {
		const n = parseDecimal(real[accountId]);
		return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) - computed;
	}
</script>

<header class="page">
	<h1>Conciliación</h1>
	<form method="GET" class="filters">
		<label>
			Cartera
			<select name="cartera" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.portfolios as p (p.id)}
					<option value={p.id} selected={p.id === data.portfolioId}>{p.name}</option>
				{/each}
			</select>
		</label>
		<label>
			Saldos al cierre del
			<input type="date" name="fecha" value={data.date} max={data.today} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
		</label>
	</form>
	<a href="/movimientos?cartera={data.portfolioId}">Volver al listado</a>
</header>

<p class="note">Teclea el saldo que muestra el broker en cada cuenta para compararlo con el que calcula la aplicación. Al guardar queda anotado, con la diferencia que hubiera.</p>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{:else if form?.saved}
	<p class="ok">Conciliación anotada en {form.saved} {form.saved === 1 ? 'cuenta' : 'cuentas'}.</p>
{/if}

<form method="POST" action="?/guardar&cartera={data.portfolioId}&fecha={data.date}">
	<input type="hidden" name="date" value={data.date} />
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="l">Cuenta</th>
					<th>Saldo calculado</th>
					<th>Saldo real</th>
					<th>Diferencia</th>
					<th class="l">Última conciliación</th>
				</tr>
			</thead>
			<tbody>
				{#each data.accounts as a (a.id)}
					{@const diff = difference(a.id, a.computed)}
					<tr>
						<td class="l">{a.name} <span class="muted">({a.currency})</span></td>
						<td class:neg={a.computed < 0}>{eur(a.computed)}</td>
						<td><input name="real-{a.id}" bind:value={real[a.id]} inputmode="decimal" size="12" placeholder={eur(a.computed)} aria-label="Saldo real de {a.name}" /></td>
						<td class:neg={diff != null && diff !== 0} class:ok={diff === 0}>{diff == null ? '' : diff === 0 ? '✓ coincide' : `${diff > 0 ? '+' : ''}${eur(diff)}`}</td>
						<td class="l">
							{#if a.last}
								{@const then = a.last.real - a.last.computed}
								{@const now = a.last.real - a.last.computedNow}
								{date(a.last.date)}:
								{#if now === 0}<span class="ok">coincide</span>{:else}<span class="neg">diferencia de {eur(now)}</span>{/if}
								{#if now !== then}<span class="muted">(al anotarla, {then === 0 ? 'coincidía' : eur(then)})</span>{/if}
							{:else}
								<span class="muted">nunca</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="row">
		<input name="notes" value={form?.raw?.notes ?? ''} placeholder="Nota (opcional)" size="40" />
		<button>Guardar conciliación</button>
	</p>
</form>

<p class="note">La diferencia es saldo real menos saldo calculado: si es positiva, en la aplicación falta un ingreso o sobra un cargo.</p>

{#if data.history.length}
	<h2>Conciliaciones anotadas</h2>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="l">Fecha</th>
					<th class="l">Cuenta</th>
					<th>Saldo real</th>
					<th>Calculado entonces</th>
					<th>Diferencia</th>
					<th class="l">Nota</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.history as r (r.id)}
					<tr>
						<td class="l">{date(r.date)}</td>
						<td class="l">{r.account} <span class="muted">({r.currency})</span></td>
						<td>{eur(r.real)}</td>
						<td>{eur(r.computed)}</td>
						<td class:neg={r.real !== r.computed} class:ok={r.real === r.computed}>{r.real === r.computed ? '✓' : eur(r.real - r.computed)}</td>
						<td class="l">{r.notes ?? ''}</td>
						<td>
							<form method="POST" action="?/borrar&cartera={data.portfolioId}&fecha={data.date}">
								<input type="hidden" name="id" value={r.id} />
								<button class="link" aria-label="Borrar la conciliación del {date(r.date)} de {r.account}">Borrar</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.page,
	.filters {
		display: flex;
		gap: 0.75rem 1rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.page {
		margin-bottom: 0.5rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 1.5rem 0 0.4rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
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
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.3rem 0.6rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		color: var(--muted);
	}
	.l {
		text-align: left;
	}
	input,
	select,
	button {
		font: inherit;
		padding: 0.3rem 0.4rem;
	}
	input,
	select {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	td input {
		text-align: right;
	}
	.row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	button.link {
		border: none;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
	.muted {
		color: var(--muted);
	}
	.neg,
	.errors {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>
