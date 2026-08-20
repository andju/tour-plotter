/**
 * Downloads the Natural Earth layers this app needs and writes trimmed
 * GeoJSON into static/basemap/. Run with `npm run fetch-basemap`.
 *
 * Source: github.com/martynafford/natural-earth-geojson, a pre-converted
 * mirror of Natural Earth's shapefiles. Fetched through the GitHub Contents
 * API (raw media type) rather than raw.githubusercontent.com, which
 * rate-limits/blocks plain scripted requests; the Contents API also lifts
 * the 1MB size cap that would otherwise truncate the larger layers.
 *
 * All layers are the 50m ("minimalistic") scale. The one exception is
 * towns.json (written after the main loop, below): the 10m populated-places
 * layer, always loaded alongside cities.json
 * (src/lib/basemap/naturalEarth.ts) to back the city-size slider — see
 * basemap/placeSize.ts. There is no separate coastline fetch: the land
 * polygon's own outline is stroked as the coastline, so one dataset drives
 * both the fill and the coast line.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPO = 'martynafford/natural-earth-geojson';
const REF = 'master';
const OUT_DIR = fileURLToPath(new URL('../static/basemap', import.meta.url));

// Coordinates are rounded to this many decimal places before writing.
// 3 decimals is ~110m of precision at the equator, far finer than this
// basemap is ever rendered at, and it cuts the dominant cost in GeoJSON
// text size (Natural Earth ships ~15 significant digits per coordinate).
const COORDINATE_PRECISION = 3;

interface Layer {
	/** Path within the source repo. */
	src: string;
	/** Output filename under static/basemap/. */
	out: string;
	/** Feature properties to keep; everything else is dropped. Empty = strip all. */
	keepProperties: string[];
	/**
	 * Maps a kept source property name to the output property name; defaults
	 * to identity. Needed because this mirror repo doesn't use consistent
	 * casing across layers — e.g. the populated-places layer's fields are
	 * upper-cased while every other layer here is lower-cased.
	 */
	renameProperties?: Record<string, string>;
}

const LAYERS: Layer[] = [
	{
		src: '50m/physical/ne_50m_land.json',
		out: 'land.json',
		keepProperties: []
	},
	{
		// 110m ("small scale") land, coarser than land.json on purpose — this
		// backs the minimap inset (render/minimap.ts), which renders a whole
		// continent or the whole world into a ~180px panel, so 50m detail
		// would cost bytes with no visible benefit. Source-independent: used
		// even when the main basemap is OSM, whose tiles carry no land
		// polygon at all — see basemap/worldLand.ts.
		src: '110m/physical/ne_110m_land.json',
		out: 'world-land.json',
		keepProperties: []
	},
	{
		// 110m admin0 boundary lines, the coarse counterpart to
		// admin0-borders.json (below) for the same reason world-land.json is
		// coarser than land.json — this backs the minimap inset, which needs
		// country borders even in OSM mode, whose tiles carry no admin0 layer
		// at all. Source-independent — see basemap/worldAdmin0.ts.
		src: '110m/cultural/ne_110m_admin_0_boundary_lines_land.json',
		out: 'world-admin0.json',
		keepProperties: []
	},
	{
		src: '50m/physical/ne_50m_lakes.json',
		out: 'lakes.json',
		keepProperties: ['name', 'min_zoom']
	},
	{
		src: '50m/physical/ne_50m_rivers_lake_centerlines_scale_rank.json',
		out: 'rivers.json',
		keepProperties: ['name', 'min_zoom', 'strokeweig']
	},
	{
		src: '50m/cultural/ne_50m_urban_areas.json',
		out: 'urban.json',
		keepProperties: ['min_zoom']
	},
	{
		src: '50m/cultural/ne_50m_admin_0_boundary_lines_land.json',
		out: 'admin0-borders.json',
		keepProperties: []
	},
	{
		src: '50m/cultural/ne_50m_admin_1_states_provinces_lines.json',
		out: 'admin1-borders.json',
		keepProperties: []
	},
	{
		// The non-"simple" layer, unlike ne_50m_populated_places_simple.json,
		// carries per-language name columns (NAME_EN, NAME_DE, ...) needed for
		// the city-label language picker; see languages.ts.
		src: '50m/cultural/ne_50m_populated_places.json',
		out: 'cities.json',
		// No min_zoom on this layer; scalerank (0 = most prominent) doubles as
		// an approximate min-zoom, since Natural Earth designs scalerank to
		// roughly track the zoom level a place becomes relevant at.
		//
		// Natural Earth only translates into these 7 languages; a
		// SUPPORTED_LANGUAGES code with no column here (languages.ts) falls
		// back to NAME, which is already English/conventional.
		keepProperties: [
			'NAME',
			'SCALERANK',
			'POP_MAX',
			'FEATURECLA',
			'NAME_EN',
			'NAME_DE',
			'NAME_ES',
			'NAME_FR',
			'NAME_PT',
			'NAME_RU',
			'NAME_ZH'
		],
		renameProperties: {
			NAME: 'name',
			SCALERANK: 'scalerank',
			POP_MAX: 'pop_max',
			FEATURECLA: 'featurecla',
			NAME_EN: 'name_en',
			NAME_DE: 'name_de',
			NAME_ES: 'name_es',
			NAME_FR: 'name_fr',
			NAME_PT: 'name_pt',
			NAME_RU: 'name_ru',
			NAME_ZH: 'name_zh'
		}
	}
];

type Position = number[];
type CoordinateTree = Position | CoordinateTree[];

function roundCoordinates(coords: CoordinateTree): CoordinateTree {
	if (typeof coords[0] === 'number') {
		return (coords as Position).map((n) => Number(n.toFixed(COORDINATE_PRECISION)));
	}
	return (coords as CoordinateTree[]).map(roundCoordinates);
}

async function fetchLayer(src: string): Promise<GeoJSON.FeatureCollection> {
	const url = `https://api.github.com/repos/${REPO}/contents/${src}?ref=${REF}`;
	const res = await fetch(url, {
		headers: {
			Accept: 'application/vnd.github.raw+json',
			'User-Agent': 'tour-plotter-fetch-basemap'
		}
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch ${src}: ${res.status} ${res.statusText}`);
	}
	return res.json() as Promise<GeoJSON.FeatureCollection>;
}

function trim(
	fc: GeoJSON.FeatureCollection,
	keepProperties: string[],
	renameProperties: Record<string, string> = {}
): GeoJSON.FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: fc.features.map((f) => ({
			type: 'Feature',
			properties:
				keepProperties.length === 0
					? {}
					: Object.fromEntries(
							keepProperties.map((k) => [renameProperties[k] ?? k, f.properties?.[k] ?? null])
						),
			geometry: {
				...f.geometry,
				coordinates: roundCoordinates((f.geometry as any).coordinates)
			} as GeoJSON.Geometry
		}))
	};
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });

	let totalBytes = 0;
	let citiesLayer: Layer | undefined;
	let cityNames = new Set<string>();

	for (const layer of LAYERS) {
		process.stdout.write(`Fetching ${layer.src}... `);
		const raw = await fetchLayer(layer.src);
		const trimmed = trim(raw, layer.keepProperties, layer.renameProperties);
		const json = JSON.stringify(trimmed);
		await writeFile(new URL(layer.out, `file://${OUT_DIR}/`), json);
		totalBytes += json.length;
		const kb = (json.length / 1024).toFixed(0);
		console.log(`${raw.features.length} features, ${kb} KB -> static/basemap/${layer.out}`);

		if (layer.out === 'cities.json') {
			citiesLayer = layer;
			cityNames = new Set(trimmed.features.map((f) => f.properties!.name as string));
		}
	}

	// towns.json: the 10m populated-places layer, minus every place already
	// in cities.json. Verified empirically (see fetch-basemap dev notes) that
	// the two files' scalerank 0-4 tiers are name-identical, and every
	// cities.json place above rank 4 has a name match in the 10m file too —
	// so filtering by name against cities.json's already-trimmed names is an
	// exact dedup, not an approximation.
	if (citiesLayer) {
		const src = '10m/cultural/ne_10m_populated_places.json';
		process.stdout.write(`Fetching ${src}... `);
		const raw = await fetchLayer(src);
		const trimmed = trim(raw, citiesLayer.keepProperties, citiesLayer.renameProperties);
		trimmed.features = trimmed.features.filter((f) => !cityNames.has(f.properties!.name as string));
		const json = JSON.stringify(trimmed);
		await writeFile(new URL('towns.json', `file://${OUT_DIR}/`), json);
		totalBytes += json.length;
		const kb = (json.length / 1024).toFixed(0);
		console.log(`${trimmed.features.length} features, ${kb} KB -> static/basemap/towns.json`);
	}

	console.log(`\nTotal: ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${LAYERS.length + 1} layers`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
