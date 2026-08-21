import { base } from '$app/paths';

/**
 * Coarse (110m) world land, backing the minimap inset. Kept separate from
 * loadBasemap.ts's per-source loaders — this data is source-independent
 * (needed even in OSM mode, whose tile source ships no land polygon at all)
 * and small enough to be fetched once, lazily, only when the minimap is
 * first switched on, and reused for the rest of the session.
 */
let worldLandPromise: Promise<GeoJSON.FeatureCollection> | null = null;

export async function loadWorldLand(fetchFn: typeof fetch = fetch): Promise<GeoJSON.FeatureCollection> {
	if (!worldLandPromise) {
		worldLandPromise = fetchFn(`${base}/basemap/world-land.json`)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load world-land.json: ${res.status} ${res.statusText}`);
				return res.json() as Promise<GeoJSON.FeatureCollection>;
			})
			.catch((err) => {
				worldLandPromise = null;
				throw err;
			});
	}
	return worldLandPromise;
}

/** Test seam: module-scope caches would otherwise leak between test cases. */
export function clearWorldLandCache(): void {
	worldLandPromise = null;
}
