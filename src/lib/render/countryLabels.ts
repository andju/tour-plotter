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

/** A forward geographic projection — the minimal shape this module needs from d3-geo's `GeoProjection`, kept narrow so this module (and its tests) don't need a real one. */
export type Projector = (point: [number, number]) => [number, number] | null;

export interface PlacedCountryLabel {
	text: string;
	xy: [number, number];
	fontSizePx: number;
}

export interface CountryLabelInput {
	countries: CountryFeatureCollection;
	projection: Projector;
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

/** Projects a GeoJSON ring to pixel space, or null if any vertex fails to project to a finite point. */
function projectRing(ring: GeoJSON.Position[], projection: Projector): Point[] | null {
	const out: Point[] = [];
	for (const position of ring) {
		const xy = projection(position as [number, number]);
		if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
		out.push(xy);
	}
	return out;
}

/** A Polygon's single ring set, or each of a MultiPolygon's parts — scored/clipped independently since a country's parts (mainland + islands) can be geographically disjoint. */
function polygonsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][][] {
	return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

interface ClippedPart {
	/** Clipped rings in GeoJSON order: outer ring first, then holes. */
	rings: Point[][];
	/** Outer ring area minus hole areas — the actually-visible area of this part. */
	areaPx2: number;
}

/** Clips one polygon part (outer ring + holes) to the canvas rect, netting out hole area. Returns null if nothing of it survives clipping. */
function clipPart(rings: GeoJSON.Position[][], projection: Projector, rect: Rect): ClippedPart | null {
	const clipped: Point[][] = [];
	let area = 0;
	rings.forEach((ring, i) => {
		const projected = projectRing(ring, projection);
		if (!projected) return;
		const clippedRing = clipRingToRect(projected, rect);
		if (clippedRing.length < 3) return;
		clipped.push(clippedRing);
		area += i === 0 ? Math.abs(ringArea(clippedRing)) : -Math.abs(ringArea(clippedRing));
	});
	if (clipped.length === 0 || area <= 0) return null;
	return { rings: clipped, areaPx2: area };
}

/**
 * Candidate anchor points for one country, ordered most-likely-to-work
 * first: the largest visible part's own area centroid (cheap, and right for
 * the common case of an unsplit, convex-ish region), then a coarse interior
 * grid over that part's bbox, ranked by distance from the nearest edge — a
 * cheap approximation of the pole of inaccessibility, covering concave or
 * split regions where the centroid itself falls outside the shape.
 */
function candidateAnchors(parts: ClippedPart[]): Point[] {
	const largest = parts.reduce((a, b) => (b.areaPx2 > a.areaPx2 ? b : a));
	const candidates: Point[] = [];

	const centroid = ringCentroid(largest.rings[0]);
	if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]) && pointInRings(centroid, largest.rings)) {
		candidates.push(centroid);
	}

	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const [x, y] of largest.rings[0]) {
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}

	const graded: Array<{ pt: Point; d: number }> = [];
	for (let i = 1; i < GRID_STEPS; i++) {
		for (let j = 1; j < GRID_STEPS; j++) {
			const pt: Point = [x0 + ((x1 - x0) * i) / GRID_STEPS, y0 + ((y1 - y0) * j) / GRID_STEPS];
			if (!pointInRings(pt, largest.rings)) continue;
			graded.push({ pt, d: distanceToRings(pt, largest.rings) });
		}
	}
	// Every interior grid point is tried, not just the top few: each one is a
	// cheap O(1)-ish check (grid-indexed collision + a handful of
	// point-in-rings tests), so there's no real cost to exhausting the grid
	// — and a hard cutoff here would mean giving up on a country just
	// because its most-central candidates happen to sit under an
	// already-placed city label, when plenty of valid room remains further
	// out.
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
		parts: ClippedPart[];
		areaPx2: number;
	}

	const scored: Scored[] = [];
	for (const feature of countries.features) {
		if (!bboxIntersects(featureBbox(feature), visibleBbox)) continue;

		const parts: ClippedPart[] = [];
		let totalArea = 0;
		for (const rings of polygonsOf(feature.geometry)) {
			const clipped = clipPart(rings, projection, rect);
			if (!clipped) continue;
			parts.push(clipped);
			totalArea += clipped.areaPx2;
		}
		if (parts.length === 0 || totalArea < minAreaPx2) continue;

		scored.push({ text: feature.properties.name.toUpperCase(), parts, areaPx2: totalArea });
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
		const allRings = country.parts.flatMap((p) => p.rings);

		let accepted: { box: Box; xy: Point } | null = null;
		for (const anchor of candidateAnchors(country.parts)) {
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
		placed.push({ text: country.text, xy: accepted.xy, fontSizePx });
	}

	return placed;
}
