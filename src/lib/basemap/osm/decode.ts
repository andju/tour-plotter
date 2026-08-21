import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { SUPPORTED_LANGUAGES } from '../languages';
import { capitalFromOsmCapital } from '../placeCapital';
import { sizeFromOsmPlace } from '../placeSize';
import type { PlaceProperties } from '../types';
import type { TileCoord } from './tiles';

export interface DecodedTile {
	water: GeoJSON.Feature[];
	waterways: GeoJSON.Feature[];
	urban: GeoJSON.Feature[];
	parks: GeoJSON.Feature[];
	admin0: GeoJSON.Feature[];
	admin1: GeoJSON.Feature[];
	places: GeoJSON.Feature<GeoJSON.Point, PlaceProperties>[];
}

// OpenMapTiles schema classes this app draws. Everything else in a layer
// (e.g. `swimming_pool` water, `drain`/`ditch` waterways) is left out so the
// basemap doesn't compete with the track.
const URBAN_LANDUSE_CLASSES = new Set([
	'residential',
	'commercial',
	'industrial',
	'retail',
	'suburb',
	'quarter',
	'neighbourhood'
]);
const URBAN_LANDCOVER_CLASSES = new Set(['wood', 'grass', 'farmland', 'wetland']);
const WATERWAY_CLASSES = new Set(['river', 'canal', 'stream']);
const PLACE_CLASSES = new Set(['city', 'town', 'village', 'hamlet']);

type Props = Record<string, number | string | boolean>;

/** The minimal shape decodeVectorTile needs from a parsed tile — matches
 * @mapbox/vector-tile's VectorTile structurally, without depending on its
 * concrete class. Keeping the categorization logic decoupled from protobuf
 * parsing this way means it can be unit-tested against a plain object,
 * rather than requiring a binary tile fixture in the repo. */
export interface MvtSource {
	layers: Record<
		string,
		| {
				length: number;
				feature(i: number): { properties: Props; toGeoJSON(x: number, y: number, z: number): GeoJSON.Feature };
		  }
		| undefined
	>;
}

/**
 * Decodes one already-parsed MVT tile into GeoJSON features grouped by this
 * app's basemap categories. Coordinates come out as WGS84 lon/lat via
 * VectorTileFeature.toGeoJSON, so the result feeds straight into the same
 * Renderer.path() calls the Natural Earth source uses — decode.ts is the
 * only place that needs to know these features were ever tile-shaped.
 */
export function decodeVectorTile(tile: MvtSource, coord: TileCoord): DecodedTile {
	const { z, x, y } = coord;

	const water = featuresFrom(tile, 'water', z, x, y, (props) => props.class !== 'swimming_pool');
	const waterways = featuresFrom(tile, 'waterway', z, x, y, (props) => WATERWAY_CLASSES.has(String(props.class)));
	const urban = [
		...featuresFrom(tile, 'landuse', z, x, y, (props) => URBAN_LANDUSE_CLASSES.has(String(props.class))),
		...featuresFrom(tile, 'landcover', z, x, y, (props) => URBAN_LANDCOVER_CLASSES.has(String(props.class)))
	];
	const parks = featuresFrom(tile, 'park', z, x, y, () => true);
	const { admin0, admin1 } = boundaryFeaturesFrom(tile, z, x, y);
	const places = featuresFrom(
		tile,
		'place',
		z,
		x,
		y,
		(props) => PLACE_CLASSES.has(String(props.class)) && String(props.name ?? '').trim() !== ''
	)
		.filter((f): f is GeoJSON.Feature<GeoJSON.Point> => f.geometry.type === 'Point')
		.map(toPlaceFeature);

	return { water, waterways, urban, parks, admin0, admin1, places };
}

/** Parses raw MVT bytes and delegates to decodeVectorTile. */
export function decodeTile(buf: ArrayBuffer, coord: TileCoord): DecodedTile {
	const tile = new VectorTile(new PbfReader(new Uint8Array(buf)));
	return decodeVectorTile(tile, coord);
}

/** Single pass over the `boundary` layer, splitting rows into admin0 (level
 * 2) and admin1 (level 4) instead of running featuresFrom twice. */
function boundaryFeaturesFrom(
	tile: MvtSource,
	z: number,
	x: number,
	y: number
): { admin0: GeoJSON.Feature[]; admin1: GeoJSON.Feature[] } {
	const layer = tile.layers.boundary;
	const admin0: GeoJSON.Feature[] = [];
	const admin1: GeoJSON.Feature[] = [];
	if (!layer) return { admin0, admin1 };

	for (let i = 0; i < layer.length; i++) {
		const feature = layer.feature(i);
		const level = Number(feature.properties.admin_level);
		if (level === 2) admin0.push(feature.toGeoJSON(x, y, z) as GeoJSON.Feature);
		else if (level === 4) admin1.push(feature.toGeoJSON(x, y, z) as GeoJSON.Feature);
	}
	return { admin0, admin1 };
}

function featuresFrom(
	tile: MvtSource,
	layerName: string,
	z: number,
	x: number,
	y: number,
	keep: (props: Props) => boolean
): GeoJSON.Feature[] {
	const layer = tile.layers[layerName];
	if (!layer) return [];

	const features: GeoJSON.Feature[] = [];
	for (let i = 0; i < layer.length; i++) {
		const feature = layer.feature(i);
		if (!keep(feature.properties)) continue;
		features.push(feature.toGeoJSON(x, y, z) as GeoJSON.Feature);
	}
	return features;
}

/**
 * OpenMapTiles tags every named place with a `name:<lang>` per language it
 * has a translation for (usually dozens), plus a plain `name` holding the
 * local-language name. Only SUPPORTED_LANGUAGES (languages.ts) — the ones
 * the UI actually offers — are pulled out here.
 */
function placeNames(props: Props): Partial<Record<string, string>> {
	const names: Partial<Record<string, string>> = {};
	for (const { code } of SUPPORTED_LANGUAGES) {
		const value = props[`name:${code}`];
		if (typeof value === 'string' && value) names[code] = value;
	}
	return names;
}

function toPlaceFeature(f: GeoJSON.Feature<GeoJSON.Point>): GeoJSON.Feature<GeoJSON.Point, PlaceProperties> {
	const props = f.properties ?? {};
	const placeClass = String(props.class ?? '');
	const rank = Number(props.rank ?? 99);
	return {
		type: 'Feature',
		geometry: f.geometry,
		properties: {
			name: String(props.name ?? ''),
			names: placeNames(props),
			rank,
			size: sizeFromOsmPlace(placeClass, rank),
			capital: capitalFromOsmCapital(props.capital == null ? null : Number(props.capital))
		}
	};
}
