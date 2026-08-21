import { base } from '$app/paths';
import { capitalFromFeatureClass } from './placeCapital';
import { sizeFromPopulation } from './placeSize';
import type { BasemapLayers, PlaceProperties } from './types';

interface CityNameColumns {
	name_en: string | null;
	name_de: string | null;
	name_es: string | null;
	name_fr: string | null;
	name_pt: string | null;
	name_ru: string | null;
	name_zh: string | null;
}

// Natural Earth only translates city names into these languages (see
// fetch-basemap.ts's `keepProperties` for the cities layer); a
// SUPPORTED_LANGUAGES code (languages.ts) absent from this map falls back to
// CityRow.name, which is already English/conventional.
const NE_NAME_COLUMNS: Record<string, keyof CityNameColumns> = {
	en: 'name_en',
	de: 'name_de',
	es: 'name_es',
	fr: 'name_fr',
	pt: 'name_pt',
	ru: 'name_ru',
	zh: 'name_zh'
};

async function loadJson<T>(path: string, fetchFn: typeof fetch): Promise<T> {
	const res = await fetchFn(`${base}/basemap/${path}`);
	if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}

interface CityRow extends CityNameColumns {
	name: string;
	scalerank: number;
	pop_max: number;
	featurecla: string | null;
}

const NE_NAME_ENTRIES = Object.entries(NE_NAME_COLUMNS);

function cityNames(row: CityNameColumns): Partial<Record<string, string>> {
	const names: Partial<Record<string, string>> = {};
	for (const [lang, column] of NE_NAME_ENTRIES) {
		const value = row[column];
		if (value) names[lang] = value;
	}
	return names;
}

/**
 * Loads the static Natural Earth 50m dataset shipped in static/basemap/ and
 * normalizes it into the same BasemapLayers shape the OSM tile source
 * produces, so composeScene never has to know which source it's drawing.
 *
 * Cities carry no min_zoom (see fetch-basemap.ts), so scalerank (0 = most
 * prominent) doubles as an approximate min-zoom — Natural Earth designs
 * scalerank to roughly track the zoom a place becomes relevant at.
 *
 * Always also fetches towns.json (the 10m populated-places layer, filtered
 * at fetch time to exclude places already in cities.json — see
 * fetch-basemap.ts) and merges it in — it gzips to a size comparable to
 * land.json, which already loads unconditionally, and it holds cities
 * (e.g. Potsdam, Innsbruck) that cities.json's 50m data omits.
 */
export async function loadNaturalEarth(fetchFn: typeof fetch = fetch): Promise<BasemapLayers> {
	const [land, lakes, rivers, urban, admin0, admin1, citiesRaw, townsRaw] = await Promise.all([
		loadJson<GeoJSON.FeatureCollection>('land.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection>('lakes.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection>('rivers.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection>('urban.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection>('admin0-borders.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection>('admin1-borders.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection<GeoJSON.Point, CityRow>>('cities.json', fetchFn),
		loadJson<GeoJSON.FeatureCollection<GeoJSON.Point, CityRow>>('towns.json', fetchFn)
	]);

	const places: GeoJSON.FeatureCollection<GeoJSON.Point, PlaceProperties> = {
		type: 'FeatureCollection',
		features: [...citiesRaw.features, ...townsRaw.features].map((f) => ({
			type: 'Feature',
			properties: {
				name: f.properties.name,
				names: cityNames(f.properties),
				rank: f.properties.scalerank,
				size: sizeFromPopulation(f.properties.pop_max),
				capital: capitalFromFeatureClass(f.properties.featurecla)
			},
			geometry: f.geometry
		}))
	};

	return {
		baseFill: 'water',
		land,
		water: lakes,
		waterways: rivers,
		urban,
		parks: { type: 'FeatureCollection', features: [] },
		admin0,
		admin1,
		places,
		attribution: '© Natural Earth',
		hasDetailLevels: true
	};
}
