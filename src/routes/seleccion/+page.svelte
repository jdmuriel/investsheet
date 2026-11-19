<script lang="ts">
	import { enhance } from '$app/forms';
	import { date, eur, pct, price } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	type Item = (typeof data.lists)[number]['rows'][number];

	// Orden de trabajo de cada lista: se cambia arrastrando o con las flechas y se guarda con un botón.
	let order = $state<Record<string, number[]>>({});
	$effect(() => {
		order = Object.fromEntries(data.lists.map((l) => [l.key, l.rows.map((r) => r.id)]));
	});
	const byId = $derived(new Map(data.lists.flatMap((l) => l.rows).map((r) => [r.id, r])));
	const rowsOf = (key: string) => (order[key] ?? []).map((id) => byId.get(id)).filter((r): r is Item => r != null);
	const dirty = $derived(data.lists.some((l) => (order[l.key] ?? []).join() !== l.rows.map((r) => r.id).join()));
	const allIds = $derived(data.lists.flatMap((l) => order[l.key] ?? []).join(','));

	function move(key: string, from: number, to: number) {
		const ids = [...(order[key] ?? [])];
		if (to < 0 || to >= ids.length) return;
		const [id] = ids.splice(from, 1);
		ids.splice(to, 0, id);
		order[key] = ids;
	}
	let dragging: { key: string; index: number } | null = null;

	let copied = $state('');
	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = ''), 1500);
	}
	const listText = (key: string) => rowsOf(key).map((r) => r.summary).join('\n');
	const allText = $derived(data.lists.map((l) => `${l.label}\n${listText(l.key)}`).join('\n\n'));

	const signedPct = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${pct(v)}`);
	const p = $derived(data.params);
	const pctInput = (v: number) => String(Math.round(v * 1e4) / 100).replace('.', ',');
	const kInput = (v: number) => String(v).replace('.', ',');
</script>

<header class="page">
	<h1>Selección</h1>
	<p class="muted">
		{#if data.lastReview}Variación desde la revisión del {date(data.lastReview.date)}.{:else}Sin revisiones anteriores.{/if}
		<button type="button" class="link" onclick={() => copy(allText, 'todo')}>{copied === 'todo' ? 'Copiado' : 'Copiar todas las líneas'}</button>
	</p>
</header>

{#if form?.errors}
	<ul class="errors">{#each form.errors as e (e)}<li>{e}</li>{/each}</ul>
{:else if form?.saved === 'cerrar'}
	<p class="ok">Revisión cerrada con el precio de {form.items} valores.</p>
{/if}

<form method="POST" action="?/orden" use:enhance class="save" class:visible={dirty}>
	<input type="hidden" name="ids" value={allIds} />
	<span>Has cambiado el orden.</span>
	<button>Guardar el orden</button>
	<button type="button" onclick={() => (order = Object.fromEntries(data.lists.map((l) => [l.key, l.rows.map((r) => r.id)])))}>Deshacer</button>
</form>

{#each data.lists as list (list.key)}
	{@const rows = rowsOf(list.key)}
	<section>
		<h2>
			{list.label} <span class="muted">({rows.length})</span>
			{#if rows.length}<button type="button" class="link" onclick={() => copy(listText(list.key), list.key)}>{copied === list.key ? 'Copiada' : 'Copiar la lista'}</button>{/if}
		</h2>
		{#if rows.length}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th class="l">Valor</th>
							<th><i>Tier</i></th>
							<th title="Coste reducido de la posición">Invertido</th>
							<th title="Inversión máxima por tier y zona">Máximo</th>
							<th title="Dividendo bruto anual sobre el precio de hoy">RPD</th>
							<th>Precio</th>
							<th>Objetivo</th>
							<th title="Precio sobre objetivo">Distancia</th>
							<th title="Desde la última revisión">Var.</th>
							<th class="l">Línea</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r, i (r.id)}
							<tr
								draggable="true"
								ondragstart={() => (dragging = { key: list.key, index: i })}
								ondragover={(e) => dragging?.key === list.key && e.preventDefault()}
								ondrop={(e) => {
									e.preventDefault();
									if (dragging?.key === list.key) move(list.key, dragging.index, i);
									dragging = null;
								}}
							>
								<td class="handle">
									<span class="muted">{i + 1}</span>
									<button type="button" title="Subir" onclick={() => move(list.key, i, i - 1)} disabled={i === 0}>↑</button>
									<button type="button" title="Bajar" onclick={() => move(list.key, i, i + 1)} disabled={i === rows.length - 1}>↓</button>
								</td>
								<th class="l" scope="row"><a href="/ajustes/valores/{r.id}?volver=/seleccion" title={[r.name, r.country].filter(Boolean).join(' · ')}>{r.ticker}</a></th>
								<td>{r.tier ?? ''}</td>
								<td>{r.invested ? eur(r.invested) : ''}</td>
								<td class:warn={r.status === 'cerca'} class:neg={r.status === 'superado'} title={r.status ? `Inversión ${r.status === 'cerca' ? 'cerca del máximo' : 'por encima del máximo'}` : undefined}>{r.max == null ? '' : eur(r.max)}</td>
								<td>{pct(r.rpd)}</td>
								<td title={r.priceDate ? `Precio del ${date(r.priceDate)}` : 'Sin precio'}>{price(r.price, r.currency)}</td>
								<td>{price(r.target, r.currency)}</td>
								<td>{signedPct(r.distance)}</td>
								<td class:neg={(r.variation ?? 0) <= -data.params.significant} class:pos={(r.variation ?? 0) >= data.params.significant}>{signedPct(r.variation)}</td>
								<td class="l line"><button type="button" class="link" title="Copiar esta línea" onclick={() => copy(r.summary, `l${r.id}`)}>{copied === `l${r.id}` ? 'Copiada' : r.summary}</button></td>
								<td>
									<form method="POST" action="?/quitar" use:enhance>
										<input type="hidden" name="security" value={r.id} />
										<button title="Quitar de la selección" onclick={(e) => confirm(`¿Quitar ${r.ticker} de la selección?`) || e.preventDefault()}>×</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted">Ningún valor.</p>
		{/if}
	</section>
{/each}

<section class="tools">
	<form method="POST" action="?/anadir" use:enhance>
		<label>
			Añadir a la selección
			<select name="security" required>
				<option value="">—</option>
				{#each data.candidates as c (c.id)}<option value={c.id}>{c.ticker}{c.name ? ` · ${c.name}` : ''}</option>{/each}
			</select>
		</label>
		<button>Añadir</button>
		<small class="muted">Entra al final de la lista que le toca por su zona y tier (se cambian en la ficha del valor).</small>
	</form>
</section>

<section>
	<h2>Cerrar la revisión</h2>
	<p class="muted">Guarda el orden de las listas y el precio de hoy de cada valor: la próxima revisión medirá la variación desde aquí. Cerrarla otra vez el mismo día la sustituye.</p>
	<form method="POST" action="?/cerrar" use:enhance class="review">
		<label>Fecha <input type="date" name="date" value={data.today} max={data.today} /></label>
		<label>Propuestas <textarea name="proposals" rows="3" placeholder="Valores candidatos y por qué"></textarea></label>
		<label>Elección <textarea name="choice" rows="2" placeholder="Qué se compra"></textarea></label>
		<button disabled={dirty} title={dirty ? 'Guarda antes el orden' : undefined}>Cerrar la revisión</button>
	</form>
</section>

{#if data.reviews.length}
	<section>
		<h2>Revisiones</h2>
		<div class="scroll">
			<table class="reviews">
				<thead><tr><th class="l">Fecha</th><th>Valores</th><th class="l">Propuestas y elección</th></tr></thead>
				<tbody>
					{#each data.reviews as rv (rv.id)}
						<tr>
							<th class="l" scope="row">{date(rv.date)}{rv.source === 'legacy' ? ' (hoja)' : ''}</th>
							<td>{rv.items}</td>
							<td class="l">
								<details>
									<summary>{rv.choice ?? rv.proposals ?? 'Sin anotar'}</summary>
									<form method="POST" action="?/notas" use:enhance class="review">
										<input type="hidden" name="review" value={rv.id} />
										<label>Propuestas <textarea name="proposals" rows="3">{rv.proposals ?? ''}</textarea></label>
										<label>Elección <textarea name="choice" rows="2">{rv.choice ?? ''}</textarea></label>
										<button>Guardar</button>
									</form>
								</details>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<section>
	<details>
		<summary>Parámetros</summary>
		<form method="POST" action="?/parametros" use:enhance class="params">
			<p class="muted">Inversión máxima por valor, en miles de euros.</p>
			<div class="grid">
				{#each ['T1', 'T2', 'T3'] as const as t (t)}
					<label>{t}, resto <input name={t} value={kInput(p.limits[t].other)} inputmode="decimal" /></label>
					<label>{t}, España <input name="{t}E" value={kInput(p.limits[t].spain)} inputmode="decimal" /></label>
				{/each}
				<label>Variación reseñable (%) <input name="significant" value={pctInput(p.significant)} inputmode="decimal" /></label>
				<label>Variación grande (%) <input name="high" value={pctInput(p.high)} inputmode="decimal" /></label>
			</div>
			<button>Guardar</button>
		</form>
	</details>
</section>

<style>
	section {
		margin: 1.5rem 0;
	}
	h2 {
		font-size: 1.1rem;
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	.l {
		text-align: left;
	}
	td.line {
		white-space: normal;
		min-width: 22rem;
	}
	tr[draggable='true'] {
		cursor: grab;
	}
	.handle {
		text-align: left;
	}
	.handle button,
	td form button {
		border: none;
		background: none;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.line .link {
		color: inherit;
	}
	.neg {
		color: var(--neg);
	}
	.pos {
		color: var(--accent);
	}
	.warn {
		color: var(--warn, #b26b00);
	}
	.save {
		display: none;
		position: sticky;
		top: 0;
		z-index: 2;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--bg, white);
		border: 1px solid var(--accent);
		border-radius: 6px;
	}
	.save.visible {
		display: flex;
	}
	.review,
	.params,
	.tools form {
		display: grid;
		gap: 0.5rem;
		max-width: 40rem;
	}
	.review label {
		display: grid;
		gap: 0.25rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.5rem;
	}
	.grid label {
		display: grid;
	}
	.ok {
		color: var(--accent);
	}
	.errors {
		color: var(--neg);
	}
</style>
