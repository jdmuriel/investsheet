/** Enlace a la misma página cambiando unos parámetros y conservando el resto (cartera, solapa…); `null` quita el parámetro. */
export function link(url: { searchParams: { toString(): string } }, params: Record<string, string | number | null>): string {
	const q = new URLSearchParams(url.searchParams.toString());
	for (const [k, v] of Object.entries(params)) {
		if (v == null) q.delete(k);
		else q.set(k, String(v));
	}
	return `?${q}`;
}
