import { DEFAULT_LANGUAGE, type LanguageCode } from '../basemap/languages';
import type { DetailBias } from '../render/detail';
import type { TitlePosition } from '../render/scene';

class ExportSettingsState {
	outputWidth = $state(1600);
	outputHeight = $state(1200);
	basemapSource: 'osm' | 'natural-earth' = $state('osm');
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
	title = $state('');
	titlePosition: TitlePosition = $state('top-center');
	showStats = $state(true);

	readonly maxDimensionPx = 4000;
}

export const exportSettings = new ExportSettingsState();
