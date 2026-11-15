import { exportDatabase } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const data = exportDatabase();
	const name = `invest-${new Date().toISOString().slice(0, 10)}.db`;
	return new Response(new Uint8Array(data), {
		headers: { 'content-type': 'application/vnd.sqlite3', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }
	});
};
