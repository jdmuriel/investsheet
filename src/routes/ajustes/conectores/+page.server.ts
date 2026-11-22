import { fail } from '@sveltejs/kit';
import { listGrants, revokeGrant } from '#lib/server/oauth.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({ grants: listGrants(getDb()), endpoint: `${url.origin}/mcp` });

export const actions: Actions = {
	revocar: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!revokeGrant(getDb(), id)) return fail(404, { error: 'Ese acceso ya no existe.' });
		return { revoked: true };
	}
};
