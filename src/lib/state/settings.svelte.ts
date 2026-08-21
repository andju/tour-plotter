import { DEFAULT_LANGUAGE, type LanguageCode } from '../basemap/languages';
import type { DetailBias } from '../render/detail';
import { DEFAULT_MAP_STYLE, type MapStyleId } from '../render/palettes';
import type { OverlayPosition } from '../render/scene';

/**
 * Reactive settings for the exported map image, backed by Svelte 5 runes.
 *
 * A single instance ({@link exportSettings}) is shared app-wide as the
 * source of truth for both the live preview ({@link PreviewCanvas}) and the
 * final render triggered from {@link ExportPanel}.
 */
class ExportSettingsState {
	outputWidth = $state(1600);
	outputHeight = $state(1200);
	basemapSource: 'osm' | 'natural-earth' = $state('osm');
	mapStyle: MapStyleId = $state(DEFAULT_MAP_STYLE);
	cityLabelLanguage: LanguageCode = $state(DEFAULT_LANGUAGE);
	/**
	 * Floor on framed coverage, in km, so small tracks don't zoom to true
	 * street level. Set low (rather than the old 200km) because the OSM
	 * source has real content — water, towns, urban areas — down to a much
	 * tighter frame than Natural Earth ever did; see bbox.ts.
	 */
	minCoverageKm = $state(25);
	detailBias: DetailBias = $state('balanced');
	/**
	 * City-size slider: 0 (largest cities only) to CITY_SIZE_MAX (every
	 * place, down to hamlets/untagged OSM points) — independent of
	 * detailBias. See basemap/placeSize.ts.
	 */
	citySize = $state(4);
	showAdmin1 = $state(true);
	showCredit = $state(true);
	showScaleBar = $state(true);
	/** Off by default: country polygons are a ~1.7MB lazy fetch, only worth paying for on demand. See render/countryLabels.ts. */
	showCountryLabels = $state(false);
	title = $state('');
	titlePosition: OverlayPosition = $state('top-center');
	showStats = $state(true);
	showMinimap = $state(false);
	minimapPosition: OverlayPosition = $state('bottom-right');
	/** Radius (km) the minimap frames around the tour; the top of its slider reaches a near-global view — see render/minimap.ts's ±84° latitude clamp. */
	minimapCoverageKm = $state(5000);

	readonly minDimensionPx = 1;
	readonly maxDimensionPx = 4000;
	readonly minCoverageFloorKm = 1;
}

export const exportSettings = new ExportSettingsState();
