import { error, redirect } from '@sveltejs/kit';
import { approve, checkAuthorize, deny } from '#lib/server/oauth.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** Petición de autorización ya comprobada; los errores que se pueden devolver al cliente se le devuelven. */
function check(url: URL) {
	const result = checkAuthorize(getDb(), url.searchParams, url.origin);
	if (result.ok) return result.request;
	if ('redirect' in result) redirect(302, result.redirect, { external: true });
	error(400, result.message);
}

// Solo se llega aquí con la sesión del propietario (hooks.server.ts).
export const load: PageServerLoad = ({ url }) => {
	const request = check(url);
	return { client: request.clientName, host: new URL(request.redirectUri).host };
};

export const actions: Actions = {
	default: async ({ request, url }) => {
		const req = check(url);
		const decision = (await request.formData()).get('decision');
		redirect(303, decision === 'permitir' ? approve(getDb(), req, url.origin) : deny(req, url.origin), { external: true });
	}
};
