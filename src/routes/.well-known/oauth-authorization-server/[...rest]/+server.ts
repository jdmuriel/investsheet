import { authorizationServerMetadata } from '#lib/server/oauth.ts';
import type { RequestHandler } from './$types';

// RFC 8414. El emisor es la raíz, pero se responde igual con un sufijo de ruta.
export const GET: RequestHandler = ({ url }) => Response.json(authorizationServerMetadata(url.origin), { headers: { 'access-control-allow-origin': '*' } });
