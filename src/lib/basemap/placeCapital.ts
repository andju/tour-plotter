/**
 * A place's administrative status, for symbol shape (render/placeSymbol.ts)
 * rather than population size. `'country'` draws as a star, `'region'` as a
 * square, `undefined` (an ordinary place) as a circle. Shared vocabulary
 * both basemap sources map into, so the renderer never learns which source
 * a place came from — same role placeSize.ts's `size` plays for population.
 */
export type PlaceCapital = 'country' | 'region';

/**
 * Natural Earth's FEATURECLA for populated places. Only the capital classes
 * matter here; every other value (Populated place, Scientific station, ...)
 * falls through to `undefined`, i.e. an ordinary place.
 */
export function capitalFromFeatureClass(featurecla: string | null | undefined): PlaceCapital | undefined {
	switch (featurecla) {
		case 'Admin-0 capital':
		case 'Admin-0 capital alt':
			return 'country';
		case 'Admin-0 region capital':
		case 'Admin-1 capital':
		case 'Admin-1 region capital':
			return 'region';
		default:
			return undefined;
	}
}

/**
 * OpenMapTiles' `place` layer tags a capital with the OSM admin_level of the
 * boundary it's capital of: 2 = country, 4 = first-order administrative
 * region (state/province). Deeper levels (5 = county-ish, 6 = municipal,
 * ...) are county/municipal seats, not what this app's square symbol means,
 * so they fall through to `undefined` like an ordinary place.
 */
export function capitalFromOsmCapital(level: number | null | undefined): PlaceCapital | undefined {
	if (level === 2) return 'country';
	if (level === 4) return 'region';
	return undefined;
}
