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
import { descriptionBandHeightPx, titleBandHeightPx, type SceneInput } from './scene';

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
	 * for (see `visibleBbox` in geo/projection.ts).
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
 *
 * Deliberately independent of the title/description text (see
 * buildSceneInput below, which reserves room for them by growing the
 * canvas rather than by feeding back into this fit) — so it, and therefore
 * the basemap fetch, stays untouched when a purely cosmetic setting
 * changes. See PreviewCanvas.svelte's framing `$derived`.
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
 * A title and/or description reserve extra canvas height above the map
 * itself (see titleBandHeightPx / descriptionBandHeightPx in scene.ts, and
 * drawDescriptionBand which draws the description directly below the title
 * band) rather than shrinking the map's own fit, which is what keeps
 * computeFraming — and the bbox/zoom it hands to the basemap fetch —
 * independent of whether either is set. Making room for them re-fits the
 * exact same bbox at the exact same scale (a second buildProjection call
 * with the framing's own inputs) and just nudges the translate down by the
 * combined band height; the result is cached per `Framing` instance *and*
 * per band amount (title-only and title+description reserve different
 * heights, and both can occur against the same Framing as the user edits
 * either field) so repeated buildSceneInput calls that land on the same
 * amount — every preview redraw that doesn't change title/description —
 * keep returning the *same* projection object. layerCache.ts's cache keys
 * are identity-based (see identityToken), so a fresh instance every call
 * would defeat them.
 */
const shiftedProjectionCache = new WeakMap<Framing, Map<number, GeoProjection>>();

function projectionForReservedBand(framing: Framing, reservedBandPx: number): GeoProjection {
	if (reservedBandPx <= 0) return framing.projection;

	let byBand = shiftedProjectionCache.get(framing);
	if (!byBand) {
		byBand = new Map();
		shiftedProjectionCache.set(framing, byBand);
	}

	let shifted = byBand.get(reservedBandPx);
	if (!shifted) {
		shifted = buildProjection(framing.outputWidth, framing.outputHeight, framing.bbox, framing.marginPx);
		const [tx, ty] = shifted.translate();
		shifted.translate([tx, ty + reservedBandPx]);
		byBand.set(reservedBandPx, shifted);
	}
	return shifted;
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

	const scale = opts.framing.outputWidth / 1000;
	const titleBandPx = title ? titleBandHeightPx(DEFAULT_SCENE_STYLE) * scale : 0;
	const descriptionBandPx = description ? descriptionBandHeightPx(DEFAULT_SCENE_STYLE) * scale : 0;
	// Rounded so outputHeight below stays integral: canvas width/height are
	// WebIDL unsigned longs, so a fractional value never reads back equal to
	// what was assigned, and code that compares the two (layerCache's
	// sizedCanvas) sees a spurious size change on every call.
	const reservedBandPx = Math.round(titleBandPx + descriptionBandPx);

	return {
		outputWidth: opts.framing.outputWidth,
		outputHeight: opts.framing.outputHeight + reservedBandPx,
		marginPx: opts.framing.marginPx,
		projection: projectionForReservedBand(opts.framing, reservedBandPx),
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
