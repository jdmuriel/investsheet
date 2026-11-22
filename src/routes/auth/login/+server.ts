import { error } from '@sveltejs/kit';
import { RETURN_COOKIE, STATE_COOKIE, authConfig, googleAuthUrl, randomToken, safeReturnPath } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ cookies, url }) => {
	const config = authConfig();
	if (!config) error(503, 'Acceso no configurado');
	const state = randomToken();
	const nonce = randomToken();
	cookies.set(STATE_COOKIE, `${state}.${nonce}`, { path: '/auth', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', maxAge: 600 });
	cookies.set(RETURN_COOKIE, safeReturnPath(url.searchParams.get('volver')), { path: '/auth', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', maxAge: 600 });
	// Redirección a un dominio externo: se responde a mano porque `redirect` solo admite destinos internos.
	return new Response(null, { status: 303, headers: { location: googleAuthUrl(config, `${url.origin}/auth/callback`, state, nonce) } });
};
