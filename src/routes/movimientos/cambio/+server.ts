import { json } from '@sveltejs/kit';
import { fxOn } from '#lib/server/market.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Tipo de cambio de referencia de una moneda en una fecha (o el del último día hábil anterior), para sugerirlo en el formulario (RF-03). */
export const GET: RequestHandler = ({ url }) => {
	const currency = (url.searchParams.get('moneda') ?? '').toUpperCase();
	const date = url.searchParams.get('fecha') ?? '';
	if (!/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(null);
	const found = fxOn(getDb(), currency, date);
	// Un cambio de hace más de diez días no sirve como referencia de esa fecha.
	return json(found && Date.parse(date) - Date.parse(found.date) <= 10 * 86400000 ? found : null);
};
