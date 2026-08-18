/**
 * A single 0-CITY_SIZE_MAX "size" scale for populated places, shared by both
 * basemap sources so the city-size slider (ExportPanel.svelte) means the
 * same thing regardless of which one is active. Lower is larger/more
 * prominent, matching PlaceProperties.rank's existing convention.
 *
 * Exact for Natural Earth, whose shipped data carries real population
 * (pop_max). OSM vector tiles carry no population — the app leans on OMT's
 * own place `class` (city/town/village/hamlet is itself a population tier)
 * refined by `rank` within that class, which is an approximation, not a
 * measurement. See placeSize.test.ts for the boundary values this file
 * commits to.
 */
export const CITY_SIZE_MAX = 10;

/** Population floor per level, index = level. Level CITY_SIZE_MAX has no floor. */
export const POPULATION_FLOORS = [
	1_000_000, 500_000, 250_000, 100_000, 50_000, 25_000, 10_000, 5_000, 2_000, 1_000
];

/** Missing/non-positive population (a small number of rows in both shipped files) sorts to the bottom, not the top. */
export function sizeFromPopulation(pop: number | null | undefined): number {
	if (pop == null || pop <= 0) return CITY_SIZE_MAX;
	for (let i = 0; i < POPULATION_FLOORS.length; i++) {
		if (pop >= POPULATION_FLOORS[i]) return i;
	}
	return CITY_SIZE_MAX;
}

/**
 * OSM's `place` class is itself a population tier (city/town/village/hamlet,
 * roughly >=100k/10k-100k/1k-10k/<1k) — `rank` further orders places within
 * a class, so it splits each tier into three levels except hamlet, which OMT
 * doesn't rank meaningfully and which maps straight to CITY_SIZE_MAX.
 */
export function sizeFromOsmPlace(placeClass: string, rank: number): number {
	switch (placeClass) {
		case 'city':
			if (rank <= 4) return 0;
			if (rank <= 6) return 1;
			if (rank <= 8) return 2;
			return 3;
		case 'town':
			if (rank <= 11) return 4;
			if (rank <= 13) return 5;
			return 6;
		case 'village':
			if (rank <= 12) return 7;
			if (rank <= 14) return 8;
			return 9;
		default:
			return CITY_SIZE_MAX;
	}
}

/** UI readout for a slider position: the population floor it selects, or "All places" at the max. */
export function populationLabel(size: number): string {
	if (size >= CITY_SIZE_MAX) return 'All places';
	return `${POPULATION_FLOORS[size].toLocaleString()}+`;
}
