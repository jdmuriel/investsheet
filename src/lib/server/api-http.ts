/** Pegamento entre las rutas de `/api/v1` y la lógica de `api.ts`. */
import { json } from '@sveltejs/kit';
import { findPortfolio, type ApiResponse } from './api.ts';
import { getDb } from './store.ts';

export const send = (response: ApiResponse): Response => json(response.body, { status: response.status });

/** Ejecuta `work` con la cartera indicada en la ruta, o responde 404. */
export function withPortfolio(key: string, work: (portfolioId: number) => ApiResponse): Response {
	const portfolio = findPortfolio(getDb(), key);
	return send(portfolio ? work(portfolio.id) : { status: 404, body: { error: `No existe la cartera «${key}».` } });
}

/** Cuerpo JSON de la petición; `undefined` si no se puede interpretar (lo rechaza la validación). */
export async function readBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

export function operationId(param: string): number | null {
	return /^\d+$/.test(param) ? Number(param) : null;
}
