import { base } from '$app/paths';

/**
 * Coarse (110m) world admin0 boundary lines, backing the minimap inset.
 * Kept separate from loadBasemap.ts's per-source loaders — this data is
 * source-independent (needed even in OSM mode, whose tile source ships no
 * admin0 layer at all) and small enough to be fetched once, lazily, only
 * when the minimap is first switched on, and reused for the rest of the
 * session. Mirrors worldLand.ts exactly; kept as a sibling file rather than
 * folded into it since that file's doc comment is specifically about land.
 */
let worldAdmin0Promise: Promise<GeoJSON.FeatureCollection> | null = null;

export async function loadWorldAdmin0(fetchFn: typeof fetch = fetch): Promise<GeoJSON.FeatureCollection> {
	if (!worldAdmin0Promise) {
		worldAdmin0Promise = fetchFn(`${base}/basemap/world-admin0.json`)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load world-admin0.json: ${res.status} ${res.statusText}`);
				return res.json() as Promise<GeoJSON.FeatureCollection>;
			})
			.catch((err) => {
				worldAdmin0Promise = null;
				throw err;
			});
	}
	return worldAdmin0Promise;
}
