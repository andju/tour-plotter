import type { Bbox } from '../../geo/bbox';
import type { BasemapLayers, PlaceProperties } from '../types';
import { decodeTile, type DecodedTile } from './decode';
import { tilesForBbox, type TileCoord } from './tiles';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ATTRIBUTION = 'OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap';

// The TileJSON embeds a build date in its tile URL template
// (.../planet/<date>/{z}/{x}/{y}.pbf), so it's resolved once and reused
// rather than hardcoded. Cached at module scope across calls within a
// session; cleared on failure so a later retry can succeed once the network
// is back.
let tileUrlTemplatePromise: Promise<string> | null = null;

function resolveTileUrlTemplate(fetchFn: typeof fetch): Promise<string> {
	if (!tileUrlTemplatePromise) {
		tileUrlTemplatePromise = fetchFn(TILEJSON_URL)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load OpenFreeMap TileJSON: ${res.status} ${res.statusText}`);
				return res.json() as Promise<{ tiles: string[] }>;
			})
			.then((tilejson) => {
				const template = tilejson.tiles[0];
				if (!template) throw new Error('OpenFreeMap TileJSON has no tile URL template');
				return template;
			})
			.catch((err) => {
				tileUrlTemplatePromise = null;
				throw err;
			});
	}
	return tileUrlTemplatePromise;
}

/**
 * Decoded tiles, keyed z/x/y. A re-render is triggered by any framing
 * change — a window resize, a nudge to the minimum-coverage floor, a track
 * toggled on — and most of those land on a tile cover that overlaps, or is
 * identical to, the one already fetched. Without this, each of them repays
 * the full network + protobuf-decode cost for tiles already in hand.
 *
 * Promises (not resolved values) are cached so concurrent requests for the
 * same tile share one fetch; a rejected entry is evicted so a later retry
 * can succeed once the network is back.
 */
const tileCache = new Map<string, Promise<DecodedTile>>();
const MAX_CACHED_TILES = 96;

/**
 * Whole merged covers, keyed by the tile cover itself. The per-tile cache
 * above already removes the network cost of a repeat; this also removes the
 * merge/dedupe pass, so a framing change that resolves to the exact same
 * cover (the common case for a resize) costs nothing at all.
 */
const coverCache = new Map<string, BasemapLayers>();
const MAX_CACHED_COVERS = 8;

/** Bounded insertion-order eviction — Map iterates oldest-first. */
function put<T>(cache: Map<string, T>, key: string, value: T, max: number): void {
	cache.set(key, value);
	if (cache.size > max) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

/** Test seam: module-scope caches would otherwise leak between test cases. */
export function clearOsmCaches(): void {
	tileCache.clear();
	coverCache.clear();
	tileUrlTemplatePromise = null;
}

function tileKey(coord: TileCoord): string {
	return `${coord.z}/${coord.x}/${coord.y}`;
}

function loadTile(template: string, coord: TileCoord, fetchFn: typeof fetch): Promise<DecodedTile> {
	const key = tileKey(coord);
	const cached = tileCache.get(key);
	if (cached) return cached;

	const pending = fetchTile(template, coord, fetchFn)
		.then((buf) => decodeTile(buf, coord))
		.catch((err) => {
			tileCache.delete(key);
			throw err;
		});
	put(tileCache, key, pending, MAX_CACHED_TILES);
	return pending;
}

function tileUrl(template: string, coord: TileCoord): string {
	return template.replace('{z}', String(coord.z)).replace('{x}', String(coord.x)).replace('{y}', String(coord.y));
}

async function fetchTile(template: string, coord: TileCoord, fetchFn: typeof fetch): Promise<ArrayBuffer> {
	const res = await fetchFn(tileUrl(template, coord));
	if (!res.ok) {
		throw new Error(`Failed to load tile ${coord.z}/${coord.x}/${coord.y}: ${res.status} ${res.statusText}`);
	}
	return res.arrayBuffer();
}

/**
 * Fetches and decodes the OSM vector tiles covering `bbox` at `zoom`,
 * merging them into a BasemapLayers. There is no partial-failure fallback:
 * if any tile in the cover fails to fetch, this rejects and the caller
 * (buildSceneInput's async pipeline) surfaces that as a loud error rather
 * than silently drawing an incomplete map or falling back to Natural Earth.
 */
export async function loadOsmTiles(bbox: Bbox, zoom: number, fetchFn: typeof fetch = fetch): Promise<BasemapLayers> {
	const cover = tilesForBbox(bbox, zoom);
	const coverKey = cover.map(tileKey).join(',');

	const cachedCover = coverCache.get(coverKey);
	if (cachedCover) return cachedCover;

	const template = await resolveTileUrlTemplate(fetchFn);
	const decoded = await Promise.all(cover.map((coord) => loadTile(template, coord, fetchFn)));

	const layers: BasemapLayers = {
		baseFill: 'land',
		land: null,
		water: toCollection(decoded.flatMap((d) => d.water)),
		waterways: toCollection(decoded.flatMap((d) => d.waterways)),
		urban: toCollection(decoded.flatMap((d) => d.urban)),
		parks: toCollection(decoded.flatMap((d) => d.parks)),
		admin0: toCollection(decoded.flatMap((d) => d.admin0)),
		admin1: toCollection(decoded.flatMap((d) => d.admin1)),
		places: dedupePlaces(decoded.flatMap((d) => d.places)),
		attribution: ATTRIBUTION,
		// decode.ts never emits min_zoom on OSM features (see BasemapLayers'
		// doc comment), so the Detail control is currently a no-op here.
		hasDetailLevels: false
	};

	put(coverCache, coverKey, layers, MAX_CACHED_COVERS);
	return layers;
}

function toCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
	return { type: 'FeatureCollection', features };
}

/**
 * Adjacent tiles overlap slightly at their edges, so the same named place
 * can arrive once per tile it touches. Dedup on name + coordinates rounded
 * to 5 decimals (~1m) rather than any tile-local id, which isn't stable
 * across tiles.
 */
function dedupePlaces(
	features: GeoJSON.Feature<GeoJSON.Point, PlaceProperties>[]
): GeoJSON.FeatureCollection<GeoJSON.Point, PlaceProperties> {
	const seen = new Set<string>();
	const deduped: GeoJSON.Feature<GeoJSON.Point, PlaceProperties>[] = [];
	for (const feature of features) {
		const [lon, lat] = feature.geometry.coordinates;
		const key = `${feature.properties.name}|${lon.toFixed(5)}|${lat.toFixed(5)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(feature);
	}
	return { type: 'FeatureCollection', features: deduped };
}
