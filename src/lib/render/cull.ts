import type { Bbox } from '../geo/bbox';

/**
 * geoBounds is deliberately not used here — `geoPath.bounds`/`geoBounds`
 * depend on ring winding to decide which side of a ring is "inside", and a
 * plain axis-aligned rectangle ring is not guaranteed to win that ambiguity
 * check (see `projection.ts`'s header comment for the same failure mode
 * hit there); on the losing side it silently returns the bounds of the
 * *entire sphere* instead of the feature's actual extent. A naive min/max
 * walk over the raw coordinates sidesteps ring semantics entirely — the
 * only cost is that a feature which itself straddles the antimeridian
 * (rare in this app's basemap data: a handful of country/land polygons)
 * gets a bbox spanning the full longitude range rather than the true
 * "short way around" extent. That's conservative, not wrong: it just means
 * that one feature is never culled, which is exactly bboxIntersects'
 * documented false-positive-only contract.
 */
function walkCoordinates(coordinates: unknown, into: (lon: number, lat: number) => void): void {
	const arr = coordinates as unknown[];
	if (typeof arr[0] === 'number') {
		const [lon, lat] = arr as [number, number];
		into(lon, lat);
		return;
	}
	for (const child of arr) walkCoordinates(child, into);
}

/**
 * A feature's own bbox, memoised per feature object. Basemap feature
 * collections are loaded once and reused by reference for the life of the
 * session (Natural Earth's module-cached promise in loadBasemap.ts, OSM's
 * coverCache in osm/source.ts), so this cost is paid once per feature ever,
 * not once per render.
 */
const featureBboxCache = new WeakMap<GeoJSON.Feature, Bbox>();

export function featureBbox(feature: GeoJSON.Feature): Bbox {
	const cached = featureBboxCache.get(feature);
	if (cached) return cached;

	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;
	if (feature.geometry.type !== 'GeometryCollection') {
		walkCoordinates(feature.geometry.coordinates, (lon, lat) => {
			minLon = Math.min(minLon, lon);
			maxLon = Math.max(maxLon, lon);
			minLat = Math.min(minLat, lat);
			maxLat = Math.max(maxLat, lat);
		});
	}

	const bbox: Bbox = [minLon, minLat, maxLon, maxLat];
	featureBboxCache.set(feature, bbox);
	return bbox;
}

/** Splits a possibly wrapping longitude range into 1-2 non-wrapping [min, max] intervals. */
function lonIntervals(minLon: number, maxLon: number): Array<[number, number]> {
	return minLon <= maxLon
		? [[minLon, maxLon]]
		: [
				[minLon, 180],
				[-180, maxLon]
			];
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 <= b1 && b0 <= a1;
}

/**
 * Whether two Bboxes overlap, honoring the antimeridian-wrap convention
 * (minLon > maxLon when the region wraps through +-180 — see Bbox's doc
 * comment in geo/bbox.ts). Latitude never wraps, so it's a plain range
 * check; longitude is split into 1-2 non-wrapping intervals per side first,
 * since a wrapping range isn't a single min/max pair to compare directly.
 *
 * Used to viewport-cull basemap features before they're handed to geoPath —
 * this can only produce false positives (a feature whose bbox overlaps the
 * viewport but whose actual geometry doesn't), never drop something that
 * should be visible, since a feature's true extent is always contained in
 * its own bbox.
 */
export function bboxIntersects(a: Bbox, b: Bbox): boolean {
	if (a[1] > b[3] || a[3] < b[1]) return false;
	for (const [a0, a1] of lonIntervals(a[0], a[2])) {
		for (const [b0, b1] of lonIntervals(b[0], b[2])) {
			if (intervalsOverlap(a0, a1, b0, b1)) return true;
		}
	}
	return false;
}
