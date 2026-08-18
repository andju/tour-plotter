export interface PlaceProperties {
	/** Default/local name — used whenever the selected language (see languages.ts) has no translation. */
	name: string;
	/** Translations keyed by language code, only present when the source actually has one. */
	names?: Partial<Record<string, string>>;
	/** Lower is more prominent. Source-specific (Natural Earth's scalerank / OSM's tile rank) — use `size` for cross-source comparisons. */
	rank: number;
	/** Lower is a larger place. 0-CITY_SIZE_MAX (placeSize.ts), normalized across both sources — unlike `rank`, comparable between them. */
	size: number;
}

/**
 * The normalized shape both basemap sources (Natural Earth, OSM vector
 * tiles) produce. composeScene draws from this and never learns which
 * source it came from — that's what keeps the two sources visually and
 * behaviorally consistent instead of drifting into two basemap renderers.
 */
export interface BasemapLayers {
	/**
	 * 'land': the page starts as land and water is painted on top (OSM/OMT
	 * tiles have no land polygon — ocean arrives as a `water` feature with
	 * class 'ocean'). 'water': the page starts as ocean and land polygons
	 * are painted on top (Natural Earth).
	 */
	baseFill: 'land' | 'water';
	/** Natural Earth only — OSM tiles carry no land polygon. */
	land: GeoJSON.FeatureCollection | null;
	/** Polygons: lake, pond, ocean, river-as-area. */
	water: GeoJSON.FeatureCollection;
	/** Lines: river, canal, stream. */
	waterways: GeoJSON.FeatureCollection;
	/** Landuse/landcover fills: residential, forest, farmland, etc. */
	urban: GeoJSON.FeatureCollection;
	parks: GeoJSON.FeatureCollection;
	admin0: GeoJSON.FeatureCollection;
	admin1: GeoJSON.FeatureCollection;
	places: GeoJSON.FeatureCollection<GeoJSON.Point, PlaceProperties>;
	/** Attribution string to render as the map credit; source-dependent. */
	attribution: string;
}
