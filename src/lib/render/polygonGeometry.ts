export type Point = [number, number];

export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/**
 * Sutherland–Hodgman polygon clipping against an axis-aligned rectangle.
 * The rectangle is convex, so this is exact (not an approximation) —
 * clipping a ring against each of the rect's four half-planes in turn
 * always yields the correct intersection polygon. Returns an empty array
 * when the ring doesn't intersect the rect at all.
 */
export function clipRingToRect(ring: Point[], rect: Rect): Point[] {
	if (ring.length === 0) return [];

	let output = ring;
	output = clipHalfPlane(output, (p) => p[0] >= rect.x0, (a, b) => intersectX(a, b, rect.x0));
	output = clipHalfPlane(output, (p) => p[0] <= rect.x1, (a, b) => intersectX(a, b, rect.x1));
	output = clipHalfPlane(output, (p) => p[1] >= rect.y0, (a, b) => intersectY(a, b, rect.y0));
	output = clipHalfPlane(output, (p) => p[1] <= rect.y1, (a, b) => intersectY(a, b, rect.y1));
	return output;
}

function clipHalfPlane(ring: Point[], inside: (p: Point) => boolean, intersect: (a: Point, b: Point) => Point): Point[] {
	if (ring.length === 0) return ring;
	const output: Point[] = [];
	for (let i = 0; i < ring.length; i++) {
		const current = ring[i];
		const previous = ring[(i - 1 + ring.length) % ring.length];
		const currentIn = inside(current);
		const previousIn = inside(previous);
		if (currentIn) {
			if (!previousIn) output.push(intersect(previous, current));
			output.push(current);
		} else if (previousIn) {
			output.push(intersect(previous, current));
		}
	}
	return output;
}

function intersectX(a: Point, b: Point, x: number): Point {
	const t = (x - a[0]) / (b[0] - a[0]);
	return [x, a[1] + t * (b[1] - a[1])];
}

function intersectY(a: Point, b: Point, y: number): Point {
	const t = (y - a[1]) / (b[1] - a[1]);
	return [a[0] + t * (b[0] - a[0]), y];
}

/** Signed shoelace area — positive for a counter-clockwise ring, negative for clockwise. */
export function ringArea(ring: Point[]): number {
	if (ring.length < 3) return 0;
	let sum = 0;
	for (let i = 0; i < ring.length; i++) {
		const [x0, y0] = ring[i];
		const [x1, y1] = ring[(i + 1) % ring.length];
		sum += x0 * y1 - x1 * y0;
	}
	return sum / 2;
}

/** Even-odd point-in-polygon test across an outer ring plus holes (GeoJSON Polygon coordinate order). */
export function pointInRings(point: Point, rings: Point[][]): boolean {
	let inside = false;
	for (const ring of rings) {
		if (pointInRing(point, ring)) inside = !inside;
	}
	return inside;
}

function pointInRing(point: Point, ring: Point[]): boolean {
	const [px, py] = point;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		const crosses = yi > py !== yj > py;
		if (crosses && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** Area-weighted centroid of a single ring. Undefined (NaN) for a degenerate zero-area ring. */
export function ringCentroid(ring: Point[]): Point {
	let area = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < ring.length; i++) {
		const [x0, y0] = ring[i];
		const [x1, y1] = ring[(i + 1) % ring.length];
		const cross = x0 * y1 - x1 * y0;
		area += cross;
		cx += (x0 + x1) * cross;
		cy += (y0 + y1) * cross;
	}
	area /= 2;
	return [cx / (6 * area), cy / (6 * area)];
}

/** Shortest distance from `point` to any edge of any ring — used to score how "interior" a candidate point is. */
export function distanceToRings(point: Point, rings: Point[][]): number {
	let min = Infinity;
	for (const ring of rings) {
		for (let i = 0; i < ring.length; i++) {
			const a = ring[i];
			const b = ring[(i + 1) % ring.length];
			min = Math.min(min, distanceToSegment(point, a, b));
		}
	}
	return min;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const lengthSq = dx * dx + dy * dy;
	const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
	const cx = a[0] + t * dx;
	const cy = a[1] + t * dy;
	return Math.hypot(p[0] - cx, p[1] - cy);
}

/**
 * Whether segment `a`-`b` crosses into or through `rect` — Liang–Barsky
 * parametric clipping. `t` walks the segment from `a` (t=0) to `b` (t=1);
 * each of the rect's four half-planes either narrows the surviving [t0, t1]
 * range or, for a segment parallel to that half-plane's boundary, rejects
 * outright when the whole line lies on the outside. Any range left with
 * t0 <= t1 means some part of the segment is inside the rect.
 */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	let t0 = 0;
	let t1 = 1;
	const halfPlanes: [number, number][] = [
		[-dx, a[0] - rect.x0],
		[dx, rect.x1 - a[0]],
		[-dy, a[1] - rect.y0],
		[dy, rect.y1 - a[1]]
	];
	for (const [p, q] of halfPlanes) {
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const r = q / p;
		if (p < 0) {
			if (r > t1) return false;
			if (r > t0) t0 = r;
		} else {
			if (r < t0) return false;
			if (r < t1) t1 = r;
		}
	}
	return t0 <= t1;
}
