import { geoPath, type GeoContext, type GeoProjection } from 'd3-geo';
import type { CountryFeatureCollection } from '../basemap/countries';
import type { Bbox } from '../geo/bbox';
import type { Track } from '../gpx/types';
import { bboxIntersects, featureBbox } from './cull';
import { LabelSpace, type Box } from './labels';
import {
	clipRingToRect,
	distanceToRings,
	pointInRings,
	ringArea,
	ringCentroid,
	segmentIntersectsRect,
	type Point,
	type Rect
} from './polygonGeometry';
import type { Font } from './renderer';

/** A forward geographic projection — the minimal shape `buildTrackObstacles` needs, kept narrow so its tests don't need a real one. Individual points never cross the antimeridian branch cut the way a country polygon's edges can, so this doesn't need geoPath's clipping. */
export type Projector = (point: [number, number]) => [number, number] | null;

export interface PlacedCountryLabel {
	text: string;
	xy: [number, number];
	fontSizePx: number;
	/**
	 * The label's reserved footprint (text plus padding), in the same pixel
	 * space as `xy` — exactly the box that was checked against `space` and
	 * `trackObstacles` before this label was accepted. Exposed so the
	 * no-overlap requirement (a country name must never cover a city dot,
	 * city label, or visible track) is directly assertable from a placed
	 * label alone, without recomputing padding/font metrics. Unused by
	 * `scene.ts`, which only needs `xy`/`fontSizePx` to draw the glyph.
	 */
	box: Box;
}

export interface CountryLabelInput {
	countries: CountryFeatureCollection;
	projection: GeoProjection;
	visibleBbox: Bbox;
	measureTextWidth: (value: string, font: Font) => number;
	fontFamily: string;
	/** 1000px-reference min/max font size (see defaultStyle.ts's `referenceFontSizePx.country`), interpolated by how much of the country's area is visible — see `layoutCountryLabels`. */
	fontSizePx: { min: number; max: number };
}

/** Below this fraction of the canvas area, a country's visible portion is too small to carry its name meaningfully — it's left unlabelled rather than crammed onto a sliver. */
const MIN_VISIBLE_AREA_FRACTION = 0.015;
/** Interior grid resolution searched for a label anchor when the largest visible part's own centroid falls outside it (concave/split regions). */
const GRID_STEPS = 12;
/** Uniform grid cell size (px) for indexing track segments — independent of label font size, since it's about segment density, not text metrics. */
const TRACK_GRID_CELL_PX = 64;

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Records a `geoPath` stream as closed pixel rings, standing in for a
 * Canvas 2D context. `geoPath` is what applies `clipAntimeridian` — the
 * same step every other layer in this renderer already gets via
 * `CanvasRenderer`'s constructor — so a ring that crosses the projection's
 * rotated branch cut arrives here already split into separate, sane rings
 * instead of one ring whose edges sweep across the whole canvas.
 */
class RingContext implements GeoContext {
	readonly rings: Point[][] = [];
	private current: Point[] = [];
	beginPath(): void {}
	arc(): void {}
	moveTo(x: number, y: number): void {
		this.flush();
		this.current = [[x, y]];
	}
	lineTo(x: number, y: number): void {
		this.current.push([x, y]);
	}
	closePath(): void {
		this.flush();
	}
	private flush(): void {
		if (this.current.length >= 3) this.rings.push(this.current);
		this.current = [];
	}
	done(): Point[][] {
		this.flush();
		return this.rings;
	}
}

interface ClippedCountry {
	/** All clipped rings for the feature, flattened across parts and holes — geoPath doesn't preserve per-part/per-hole structure, so this list carries no ordering guarantee beyond "one entry per surviving ring". */
	rings: Point[][];
	/** Sum of signed ring area over the clipped rings: positive outer rings minus positive-signed holes (verified empirically — geoPath emits holes at negative signed area), i.e. the actually-visible area of the feature. */
	areaPx2: number;
}

/** Projects and clips a whole feature's geometry to the canvas rect via `geoPath` (for antimeridian clipping — see `RingContext`), keeping rings with >=3 points and netting hole area out via signed area. Returns null if nothing of it survives clipping, or if the net area isn't positive (e.g. only holes survived). */
function clipFeatureToRect(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, projection: GeoProjection, rect: Rect): ClippedCountry | null {
	const recorder = new RingContext();
	geoPath(projection, recorder)(geometry);

	const clipped: Point[][] = [];
	let area = 0;
	for (const ring of recorder.done()) {
		const clippedRing = clipRingToRect(ring, rect);
		if (clippedRing.length < 3) continue;
		clipped.push(clippedRing);
		area += ringArea(clippedRing);
	}
	if (clipped.length === 0 || area <= 0) return null;
	return { rings: clipped, areaPx2: area };
}

/**
 * Candidate anchor points for one country, ordered most-likely-to-work
 * first: the anchor ring's own area centroid (cheap, and right for the
 * common case of an unsplit, convex-ish region), then a coarse interior
 * grid over that ring's bbox, ranked by distance from the nearest edge — a
 * cheap approximation of the pole of inaccessibility, covering concave or
 * split regions where the centroid itself falls outside the shape. The
 * anchor ring is the largest-by-positive-signed-area ring among all of the
 * feature's clipped rings (geoPath flattens parts and holes together, so
 * "largest part's outer ring" is found this way rather than from any
 * surviving per-part structure); containment checks below still test
 * against every ring, since even-odd already accounts for holes.
 */
function candidateAnchors(rings: Point[][]): Point[] {
	const anchorRing = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
	const candidates: Point[] = [];

	const centroid = ringCentroid(anchorRing);
	if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]) && pointInRings(centroid, rings)) {
		candidates.push(centroid);
	}

	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const [x, y] of anchorRing) {
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}

	const graded: Array<{ pt: Point; d: number }> = [];
	for (let i = 1; i < GRID_STEPS; i++) {
		for (let j = 1; j < GRID_STEPS; j++) {
			const pt: Point = [x0 + ((x1 - x0) * i) / GRID_STEPS, y0 + ((y1 - y0) * j) / GRID_STEPS];
			if (!pointInRings(pt, rings)) continue;
			graded.push({ pt, d: distanceToRings(pt, rings) });
		}
	}
	// Every interior grid point is tried, not just the top few. Each check
	// (pointInRings + distanceToRings) scans every vertex of every ring, so
	// this is O(GRID_STEPS^2 * V), not O(1) — but V is small enough at
	// Natural Earth 50m's vertex counts that it stays cheap in absolute
	// terms: warm layout is ~7ms for a Germany frame, ~11ms for a US frame,
	// ~50ms for a whole-world frame (all bitmap-cached, see layerCache.ts).
	// A hard cutoff here would mean giving up on a country just because its
	// most-central candidates happen to sit under an already-placed city
	// label, when plenty of valid room remains further out.
	graded.sort((a, b) => b.d - a.d);
	for (const { pt } of graded) candidates.push(pt);

	return candidates;
}

/**
 * Uniform grid over track segments, the country-label counterpart of
 * `labels.ts`'s `ReservedBoxGrid` (boxes there, line segments here) — a
 * candidate label box is only tested against segments sharing its cell,
 * not the whole track, which is what keeps this affordable for tracks with
 * many thousands of points.
 */
class SegmentGrid {
	private readonly cellSize: number;
	private readonly cells = new Map<string, number[]>();
	private readonly segments: [Point, Point][] = [];

	constructor(cellSize: number = TRACK_GRID_CELL_PX) {
		this.cellSize = cellSize > 0 ? cellSize : TRACK_GRID_CELL_PX;
	}

	insert(a: Point, b: Point): void {
		const index = this.segments.push([a, b]) - 1;
		const x0 = Math.floor(Math.min(a[0], b[0]) / this.cellSize);
		const x1 = Math.floor(Math.max(a[0], b[0]) / this.cellSize);
		const y0 = Math.floor(Math.min(a[1], b[1]) / this.cellSize);
		const y1 = Math.floor(Math.max(a[1], b[1]) / this.cellSize);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				const key = `${cx},${cy}`;
				const bucket = this.cells.get(key);
				if (bucket) bucket.push(index);
				else this.cells.set(key, [index]);
			}
		}
	}

	intersectsBox(box: Box): boolean {
		const x0 = Math.floor(box.x0 / this.cellSize);
		const x1 = Math.floor(box.x1 / this.cellSize);
		const y0 = Math.floor(box.y0 / this.cellSize);
		const y1 = Math.floor(box.y1 / this.cellSize);
		const seen = new Set<number>();
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				const bucket = this.cells.get(`${cx},${cy}`);
				if (!bucket) continue;
				for (const index of bucket) seen.add(index);
			}
		}
		for (const index of seen) {
			const [a, b] = this.segments[index];
			if (segmentIntersectsRect(a, b, box)) return true;
		}
		return false;
	}
}

/** Projects every visible track's points into a `SegmentGrid`, once per overlay pass, for country labels to route around. */
export function buildTrackObstacles(tracks: Track[], projection: Projector): SegmentGrid {
	const grid = new SegmentGrid();
	for (const track of tracks) {
		for (const segment of track.segments) {
			let previous: Point | null = null;
			for (const point of segment) {
				const xy = projection([point.lon, point.lat]);
				if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) {
					previous = null;
					continue;
				}
				if (previous) grid.insert(previous, xy);
				previous = xy;
			}
		}
	}
	return grid;
}

/**
 * Places country-name labels: largest visible country first, into whatever
 * space `space` (shared with city labels, placed earlier — see
 * scene.ts's `layoutPlaces`) and `trackObstacles` leave free. A country is
 * skipped entirely — not shrunk or repositioned past its candidate list —
 * when its visible area falls below `MIN_VISIBLE_AREA_FRACTION` or none of
 * its candidate anchors clear the checks; there's no reason a tour map
 * needs every marginally-visible border country named.
 */
export function layoutCountryLabels(
	input: CountryLabelInput,
	scale: number,
	canvasWidth: number,
	canvasHeight: number,
	space: LabelSpace,
	trackObstacles: SegmentGrid | null
): PlacedCountryLabel[] {
	const { countries, projection, visibleBbox, measureTextWidth, fontFamily } = input;

	const rect: Rect = { x0: 0, y0: 0, x1: canvasWidth, y1: canvasHeight };
	const canvasArea = canvasWidth * canvasHeight;
	const minAreaPx2 = MIN_VISIBLE_AREA_FRACTION * canvasArea;
	const { min: fontMin, max: fontMax } = input.fontSizePx;

	interface Scored {
		text: string;
		rings: Point[][];
		areaPx2: number;
	}

	const scored: Scored[] = [];
	for (const feature of countries.features) {
		if (!bboxIntersects(featureBbox(feature), visibleBbox)) continue;

		const clipped = clipFeatureToRect(feature.geometry, projection, rect);
		if (!clipped || clipped.areaPx2 < minAreaPx2) continue;

		scored.push({ text: feature.properties.name.toUpperCase(), rings: clipped.rings, areaPx2: clipped.areaPx2 });
	}

	// Largest visible country first, so the dominant one on screen gets first pick of the space.
	scored.sort((a, b) => b.areaPx2 - a.areaPx2);

	const placed: PlacedCountryLabel[] = [];
	for (const country of scored) {
		const t = clamp(Math.sqrt(country.areaPx2 / canvasArea) / 0.6, 0, 1);
		const fontSizePx = lerp(fontMin, fontMax, t) * scale;
		const textWidth = measureTextWidth(country.text, { sizePx: fontSizePx, family: fontFamily });
		const paddingPx = fontSizePx * 0.4;
		const halfWidth = textWidth / 2 + paddingPx;
		const halfHeight = fontSizePx / 2 + paddingPx;
		const allRings = country.rings;

		let accepted: { box: Box; xy: Point } | null = null;
		for (const anchor of candidateAnchors(country.rings)) {
			const box: Box = {
				x0: anchor[0] - halfWidth,
				y0: anchor[1] - halfHeight,
				x1: anchor[0] + halfWidth,
				y1: anchor[1] + halfHeight
			};
			if (box.x0 < 0 || box.y0 < 0 || box.x1 > canvasWidth || box.y1 > canvasHeight) continue;

			// The box's center and both horizontal end-midpoints must all sit
			// inside the visible rings — stops a name from being drawn across a
			// narrow strip that only passed the (whole-part) area test.
			const leftMid: Point = [box.x0, anchor[1]];
			const rightMid: Point = [box.x1, anchor[1]];
			if (!pointInRings(anchor, allRings) || !pointInRings(leftMid, allRings) || !pointInRings(rightMid, allRings)) {
				continue;
			}

			if (space.collides(box)) continue;
			if (trackObstacles?.intersectsBox(box)) continue;

			accepted = { box, xy: anchor };
			break;
		}

		if (!accepted) continue;
		space.insert(accepted.box);
		placed.push({ text: country.text, xy: accepted.xy, fontSizePx, box: accepted.box });
	}

	return placed;
}
