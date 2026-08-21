import type { Bbox } from '../geo/bbox';
import { loadNaturalEarth } from './naturalEarth';
import { clearOsmCaches, loadOsmTiles } from './osm/source';
import type { BasemapLayers } from './types';

export type BasemapSource = 'osm' | 'natural-earth';

// Natural Earth is static data independent of framing, so it's fetched once
// and cached at module scope — loaded lazily on first selection rather than
// unconditionally at startup, so OSM-mode users never pay for it. OSM tiles
// depend on the current bbox/zoom and are always fetched fresh.
let naturalEarthPromise: Promise<BasemapLayers> | null = null;

export async function loadBasemap(
	source: BasemapSource,
	bbox: Bbox,
	zoom: number,
	fetchFn: typeof fetch = fetch
): Promise<BasemapLayers> {
	if (source === 'natural-earth') {
		if (!naturalEarthPromise) {
			naturalEarthPromise = loadNaturalEarth(fetchFn).catch((err) => {
				naturalEarthPromise = null;
				throw err;
			});
		}
		return naturalEarthPromise;
	}
	return loadOsmTiles(bbox, zoom, fetchFn);
}

/** Test seam: module-scope caches would otherwise leak between test cases. */
export function clearBasemapCaches(): void {
	naturalEarthPromise = null;
	clearOsmCaches();
}
