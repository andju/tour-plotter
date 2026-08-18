import type { Bbox } from '../../geo/bbox';

export interface TileCoord {
	z: number;
	x: number;
	y: number;
}

const MAX_TILES = 32;
/** OpenFreeMap's planet source tops out here; frames tighter than this overzoom the z14 tile. */
const MAX_SOURCE_ZOOM = 14;

/**
 * Web-Mercator tile x/y for a lon/lat at zoom z. Longitude wraps; latitude
 * is clamped to Mercator's finite range (~85.0511°) before projecting.
 */
function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const x = ((lon + 180) / 360) * n;
	const latRad = (Math.max(Math.min(lat, 85.0511), -85.0511) * Math.PI) / 180;
	const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
	return { x, y };
}

/**
 * The set of tiles covering `bbox` at the given zoom, stepping the zoom
 * down until the cover fits within MAX_TILES. This is what stops a wide
 * (e.g. continental) frame from requesting hundreds of tiles: rather than
 * fetching a fixed set at a fixed zoom, the cover itself adapts.
 */
export function tilesForBbox(bbox: Bbox, requestedZoom: number): TileCoord[] {
	const z = Math.max(0, Math.min(Math.round(requestedZoom), MAX_SOURCE_ZOOM));
	for (let zoom = z; zoom >= 0; zoom--) {
		const cover = coverAtZoom(bbox, zoom);
		if (cover.length <= MAX_TILES || zoom === 0) return cover;
	}
	return coverAtZoom(bbox, 0);
}

function coverAtZoom(bbox: Bbox, zoom: number): TileCoord[] {
	const [minLon, minLat, maxLon, maxLat] = bbox;
	const n = 2 ** zoom;

	const nw = lonLatToTile(minLon, maxLat, zoom);
	const se = lonLatToTile(maxLon, minLat, zoom);

	const y0 = Math.max(0, Math.floor(nw.y));
	const y1 = Math.min(n - 1, Math.floor(se.y));

	// Longitude may wrap (minLon > maxLon by this app's Bbox convention), in
	// which case the tile-x range wraps past n back to 0 rather than running
	// backwards.
	const x0 = Math.floor(nw.x);
	const x1raw = Math.floor(se.x);
	const wraps = minLon > maxLon;
	const x1 = wraps ? x1raw + n : x1raw;

	// A dedup pass, keyed on the wrapped x, is needed because a bbox spanning
	// the full 360° width (e.g. [-180, .., 180, ..], which
	// expandToMinimumCoverage produces for world-spanning tracks) has its
	// east and west edges land on the same tile column after wrapping.
	const seen = new Set<number>();
	const tiles: TileCoord[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const wrappedX = ((x % n) + n) % n;
			const key = y * n + wrappedX;
			if (seen.has(key)) continue;
			seen.add(key);
			tiles.push({ z: zoom, x: wrappedX, y });
		}
	}
	return tiles;
}
