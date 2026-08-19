import type { GeoProjection } from 'd3-geo';
import type { BasemapLayers } from '../basemap/types';
import { bboxOfTracks, expandToMinimumCoverage, type Bbox } from '../geo/bbox';
import { buildProjection, visibleBbox } from '../geo/projection';
import { combineStats, formatStats } from '../gpx/format';
import { computeStats } from '../gpx/stats';
import type { Track } from '../gpx/types';
import { zoomForProjection, type DetailBias } from './detail';
import { measureTextWidth } from './measure';
import { sceneStyleFor, type MapStyleId } from './palettes';
import type { SceneInput, TitlePosition } from './scene';

/** Margins are defined at this reference width, like everything else in SceneStyle. */
const REFERENCE_MARGIN_PX = 40;

export interface Framing {
	outputWidth: number;
	outputHeight: number;
	marginPx: number;
	bbox: Bbox;
	/**
	 * The full extent actually visible on the canvas — wider than `bbox`
	 * along whichever axis the aspect-ratio fit doesn't bind, plus the
	 * margin. This, not `bbox`, is what basemap sources should fetch data
	 * for (see `visibleBbox` in geo/projection.ts) — fetching by `bbox`
	 * alone would leave the framing slack on the non-binding axis with no
	 * basemap data.
	 */
	visibleBbox: Bbox;
	projection: GeoProjection;
	/** Effective web-Mercator zoom of this framing — feeds both the OSM tile cover and Natural Earth's detail thinning. */
	zoom: number;
}

export interface ComputeFramingOptions {
	width: number;
	height: number;
	visibleTracks: Track[];
	minCoverageKm: number;
}

/**
 * Computes the framing (bbox + projection) for the current tracks, before
 * any basemap data is loaded. Split out from buildSceneInput because
 * fetching OSM tiles needs the bbox and zoom this produces — framing must
 * happen first, then basemap data loads (possibly async), then
 * buildSceneInput assembles the final SceneInput. Kept synchronous and
 * side-effect-free so it stays trivially shared between preview and export.
 */
export function computeFraming(opts: ComputeFramingOptions): Framing | null {
	if (opts.visibleTracks.length === 0) return null;

	const marginPx = REFERENCE_MARGIN_PX * (opts.width / 1000);
	const bbox = expandToMinimumCoverage(bboxOfTracks(opts.visibleTracks), opts.minCoverageKm);
	const projection = buildProjection(opts.width, opts.height, bbox, marginPx);

	return {
		outputWidth: opts.width,
		outputHeight: opts.height,
		marginPx,
		bbox,
		visibleBbox: visibleBbox(projection, opts.width, opts.height),
		projection,
		zoom: zoomForProjection(projection)
	};
}

export interface BuildSceneOptions {
	framing: Framing;
	visibleTracks: Track[];
	basemap: BasemapLayers;
	mapStyle: MapStyleId;
	detailBias: DetailBias;
	showAdmin1: boolean;
	showCredit: boolean;
	showScaleBar: boolean;
	showStats: boolean;
	title: string;
	titlePosition: TitlePosition;
	cityLabelLanguage: string;
	citySize: number;
}

/**
 * Turns app state plus already-loaded basemap data into a SceneInput. Used
 * by both the live preview and the actual export — sharing this one
 * function (and computeFraming above it) is what keeps them from drifting
 * apart, since "preview" is otherwise just "export at a smaller size" and
 * there's no reason for the two to compute framing or layout differently.
 */
export function buildSceneInput(opts: BuildSceneOptions): SceneInput {
	const statsText = opts.showStats ? formatStats(combineStats(opts.visibleTracks.map(computeStats))) : null;
	const title = opts.title.trim() || null;

	return {
		outputWidth: opts.framing.outputWidth,
		outputHeight: opts.framing.outputHeight,
		marginPx: opts.framing.marginPx,
		projection: opts.framing.projection,
		visibleBbox: opts.framing.visibleBbox,
		basemap: opts.basemap,
		tracks: opts.visibleTracks,
		overlay: {
			title,
			titlePosition: opts.titlePosition,
			statsText,
			showAdmin1: opts.showAdmin1,
			showCredit: opts.showCredit,
			showScaleBar: opts.showScaleBar,
			detailBias: opts.detailBias,
			cityLabelLanguage: opts.cityLabelLanguage,
			citySize: opts.citySize
		},
		style: sceneStyleFor(opts.mapStyle),
		measureTextWidth
	};
}
