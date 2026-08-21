import { base } from '$app/paths';

export interface CountryProperties {
	name: string;
}

export type CountryFeatureCollection = GeoJSON.FeatureCollection<
	GeoJSON.Polygon | GeoJSON.MultiPolygon,
	CountryProperties
>;

/**
 * Country polygons, backing country-name labels (render/countryLabels.ts).
 * Source-independent like worldLand.ts/worldAdmin0.ts — needed even in OSM
 * mode, whose vector tiles carry no country polygon at all — and, like
 * those, fetched once, lazily, only when country labels are first switched
 * on, and reused for the rest of the session. Unlike basemap/loadBasemap.ts's
 * per-source data, this is never drawn: the borders on the map still come
 * from admin0-borders.json's lines.
 */
let countriesPromise: Promise<CountryFeatureCollection> | null = null;

export async function loadCountries(fetchFn: typeof fetch = fetch): Promise<CountryFeatureCollection> {
	if (!countriesPromise) {
		countriesPromise = fetchFn(`${base}/basemap/countries.json`)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load countries.json: ${res.status} ${res.statusText}`);
				return res.json() as Promise<CountryFeatureCollection>;
			})
			.catch((err) => {
				countriesPromise = null;
				throw err;
			});
	}
	return countriesPromise;
}

/** Test seam: module-scope caches would otherwise leak between test cases. */
export function clearCountriesCache(): void {
	countriesPromise = null;
}
