import { fail } from '@sveltejs/kit';
import { run, totalShares } from '#lib/engine/engine.ts';
import { latestFx, latestQuotes, marketStatus, refreshMarketIfStale, saveManualPrice } from '#lib/server/market.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb, loadOperations } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

export const load: PageServerLoad = ({ url, locals }) => {
	void url.searchParams.get('cartera');
	const db = getDb();
	const quotes = latestQuotes(db);
	const positions = locals.portfolioId == null ? new Map() : run(loadOperations(locals.portfolioId, db)).state.positions;
	const securities = (db.prepare('SELECT id, ticker, price_ticker AS priceTicker, name, currency, active FROM security ORDER BY ticker').all() as { id: number; ticker: string; priceTicker: string | null; name: string | null; currency: string | null; active: number }[])
		.map((s) => ({ ...s, held: totalShares(positions.get(s.id)) > 0, quote: quotes.get(s.id) ?? null }))
		// Primero los que están en cartera; los inactivos sin posición ni precio no hacen falta.
		.filter((s) => s.held || s.active || s.quote)
		.sort((a, b) => Number(b.held) - Number(a.held) || a.ticker.localeCompare(b.ticker));
	return { today: todayInMadrid(), securities, fx: [...latestFx(db)].map(([currency, r]) => ({ currency, ...r })).sort((a, b) => a.currency.localeCompare(b.currency)), status: marketStatus(db) };
};

export const actions: Actions = {
	guardar: async ({ request }) => {
		const raw = rawFromForm(await request.formData());
		const result = saveManualPrice(getDb(), Number(raw.id), { price: raw.price, date: raw.date });
		if (!result.ok) return fail(400, { errors: result.errors, id: Number(raw.id), raw });
		return { savedId: Number(raw.id) };
	},
	actualizar: async () => {
		await refreshMarketIfStale(getDb(), { force: true });
		return { refreshed: true };
	}
};
