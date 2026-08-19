import type { GeoProjection } from 'd3-geo';
import type { BasemapLayers } from '../basemap/types';
import { bboxOfTracks, expandToMinimumCoverage, type Bbox } from '../geo/bbox';
import { buildProjection, visibleBbox } from '../geo/projection';
import { combineStats, formatStats } from '../gpx/format';
import { computeStats } from '../gpx/stats';
import type { Track } from '../gpx/types';
import { zoomForProjection, type DetailBias } from './detail';
import { DEFAULT_SCENE_STYLE } from './defaultStyle';
import { measureTextWidth } from './measure';
import { reservedBandPx, type SceneInput } from './scene';

/** Margins are defined at this reference width, like everything else in SceneStyle. */
const REFERENCE_MARGIN_PX = 40;

export interface Framing {
	outputWidth: number;
	outputHeight: number;
	marginPx: number;
	/**
	 * Space reserved above the map for the title/description bands, in
	 * output pixels — see `reservedBandPx` in scene.ts. `buildProjection`
	 * treats this as unavailable space when fitting `bbox`, so the map
	 * shrinks slightly to make room rather than the canvas growing or the
	 * projection being shifted after the fact. Carried on `Framing` (rather
	 * than recomputed in buildSceneInput) so `projection` and `visibleBbox`
	 * below are already correct for it.
	 */
	reservedTopPx: number;
	bbox: Bbox;
	/**
	 * The full extent actually visible on the canvas — wider than `bbox`
	 * along whichever axis the aspect-ratio fit doesn't bind, plus the
	 * margin, and including the reserved title/description band (the
	 * projection covers the whole canvas; only its *fit* treats the band as
	 * unavailable — see `buildProjection`'s `topInsetPx`). This, not `bbox`,
	 * is what basemap sources should fetch data for (see `visibleBbox` in
	 * geo/projection.ts) — fetching by `bbox` alone would leave the band, and
	 * the framing slack on the non-binding axis, with no basemap data.
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
	/**
	 * Presence only, not the text itself — so the fit (and the OSM fetch it
	 * drives) is invalidated once per empty↔non-empty transition rather than
	 * once per keystroke. See PreviewCanvas.svelte's `hasTitle`/`hasDescription`.
	 */
	hasTitle: boolean;
	hasDescription: boolean;
}

/**
 * Computes the framing (bbox + projection) for the current tracks, before
 * any basemap data is loaded. Split out from buildSceneInput because
 * fetching OSM tiles needs the bbox and zoom this produces — framing must
 * happen first, then basemap data loads (possibly async), then
 * buildSceneInput assembles the final SceneInput. Kept synchronous and
 * side-effect-free so it stays trivially shared between preview and export.
 *
 * Depends on title/description *presence* (via `hasTitle`/`hasDescription`),
 * not their text — a title/description reserves room by shrinking the map's
 * own fit (see `reservedTopPx` above and `buildProjection`'s `topInsetPx`),
 * so the bbox/zoom this hands to the basemap fetch must already account for
 * it, but a keystroke that doesn't cross the empty↔non-empty boundary must
 * not re-trigger that fetch. See PreviewCanvas.svelte's framing `$derived`.
 */
export function computeFraming(opts: ComputeFramingOptions): Framing | null {
	if (opts.visibleTracks.length === 0) return null;

	const marginPx = REFERENCE_MARGIN_PX * (opts.width / 1000);
	const bbox = expandToMinimumCoverage(bboxOfTracks(opts.visibleTracks), opts.minCoverageKm);
	const reservedTopPx = reservedBandPx(
		{ title: opts.hasTitle ? 'x' : null, description: opts.hasDescription ? 'x' : null },
		DEFAULT_SCENE_STYLE,
		opts.width / 1000
	);
	const projection = buildProjection(opts.width, opts.height, bbox, marginPx, reservedTopPx);

	return {
		outputWidth: opts.width,
		outputHeight: opts.height,
		marginPx,
		reservedTopPx,
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
	detailBias: DetailBias;
	showAdmin1: boolean;
	showCredit: boolean;
	showScaleBar: boolean;
	showStats: boolean;
	title: string;
	description: string;
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
	const description = opts.description.trim() || null;

	return {
		outputWidth: opts.framing.outputWidth,
		outputHeight: opts.framing.outputHeight,
		marginPx: opts.framing.marginPx,
		reservedTopPx: opts.framing.reservedTopPx,
		projection: opts.framing.projection,
		basemap: opts.basemap,
		tracks: opts.visibleTracks,
		overlay: {
			title,
			statsText,
			description,
			showAdmin1: opts.showAdmin1,
			showCredit: opts.showCredit,
			showScaleBar: opts.showScaleBar,
			detailBias: opts.detailBias,
			cityLabelLanguage: opts.cityLabelLanguage,
			citySize: opts.citySize
		},
		style: DEFAULT_SCENE_STYLE,
		measureTextWidth
	};
}
