import { listPortfolios } from '#lib/server/store.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	// Leer el parámetro hace que la barra se actualice al cambiar de cartera sin recargar la página.
	void url.searchParams.get('cartera');
	return { portfolios: listPortfolios(), portfolioId: locals.portfolioId ?? null };
};
