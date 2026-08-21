import { describe, expect, it } from 'vitest';
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

const RECT: Rect = { x0: 0, y0: 0, x1: 100, y1: 100 };

describe('clipRingToRect', () => {
	it('returns the ring unchanged when fully inside', () => {
		const ring: Point[] = [
			[10, 10],
			[90, 10],
			[90, 90],
			[10, 90]
		];
		expect(clipRingToRect(ring, RECT)).toEqual(ring);
	});

	it('returns an empty array when fully outside', () => {
		const ring: Point[] = [
			[200, 200],
			[300, 200],
			[300, 300]
		];
		expect(clipRingToRect(ring, RECT)).toEqual([]);
	});

	it('clips a ring straddling one edge down to the rect boundary', () => {
		const ring: Point[] = [
			[-50, 25],
			[50, 25],
			[50, 75],
			[-50, 75]
		];
		const clipped = clipRingToRect(ring, RECT);
		for (const [x] of clipped) expect(x).toBeGreaterThanOrEqual(0);
		expect(ringArea(clipped)).toBeCloseTo(50 * 50, 5);
	});

	it('clips a ring straddling a corner to a smaller polygon', () => {
		const ring: Point[] = [
			[50, 50],
			[150, 50],
			[150, 150],
			[50, 150]
		];
		const clipped = clipRingToRect(ring, RECT);
		expect(Math.abs(ringArea(clipped))).toBeCloseTo(50 * 50, 5);
	});
});

describe('ringArea', () => {
	it('is positive for a counter-clockwise square', () => {
		const ring: Point[] = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		expect(ringArea(ring)).toBeCloseTo(100, 5);
	});

	it('is negative for the same square wound clockwise', () => {
		const ring: Point[] = [
			[0, 0],
			[0, 10],
			[10, 10],
			[10, 0]
		];
		expect(ringArea(ring)).toBeCloseTo(-100, 5);
	});

	it('visible area is outer minus hole via absolute values', () => {
		const outer: Point[] = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		const hole: Point[] = [
			[3, 3],
			[3, 7],
			[7, 7],
			[7, 3]
		];
		const visible = Math.abs(ringArea(outer)) - Math.abs(ringArea(hole));
		expect(visible).toBeCloseTo(100 - 16, 5);
	});
});

describe('pointInRings', () => {
	const outer: Point[] = [
		[0, 0],
		[10, 0],
		[10, 10],
		[0, 10]
	];
	const hole: Point[] = [
		[3, 3],
		[3, 7],
		[7, 7],
		[7, 3]
	];

	it('is true inside the outer ring with no holes', () => {
		expect(pointInRings([5, 5], [outer])).toBe(true);
	});

	it('is false outside the outer ring', () => {
		expect(pointInRings([50, 50], [outer])).toBe(false);
	});

	it('is false inside a hole', () => {
		expect(pointInRings([5, 5], [outer, hole])).toBe(false);
	});

	it('is true between the hole and the outer boundary', () => {
		expect(pointInRings([1, 1], [outer, hole])).toBe(true);
	});
});

describe('ringCentroid', () => {
	it('is the geometric center of a square', () => {
		const ring: Point[] = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];
		const [cx, cy] = ringCentroid(ring);
		expect(cx).toBeCloseTo(5, 5);
		expect(cy).toBeCloseTo(5, 5);
	});
});

describe('distanceToRings', () => {
	const ring: Point[] = [
		[0, 0],
		[10, 0],
		[10, 10],
		[0, 10]
	];

	it('is the max at the center of a square (farthest from every edge)', () => {
		const centerDistance = distanceToRings([5, 5], [ring]);
		const offCenterDistance = distanceToRings([2, 5], [ring]);
		expect(centerDistance).toBeGreaterThan(offCenterDistance);
		expect(centerDistance).toBeCloseTo(5, 5);
	});

	it('is zero on the boundary', () => {
		expect(distanceToRings([0, 5], [ring])).toBeCloseTo(0, 5);
	});
});

describe('segmentIntersectsRect', () => {
	it('is true when the segment passes straight through', () => {
		expect(segmentIntersectsRect([-10, 50], [110, 50], RECT)).toBe(true);
	});

	it('is false when the segment lies entirely outside', () => {
		expect(segmentIntersectsRect([200, 200], [300, 300], RECT)).toBe(false);
	});

	it('is true when the segment only clips a corner', () => {
		expect(segmentIntersectsRect([-10, 90], [90, -10], RECT)).toBe(true);
	});

	it('is true when both endpoints are inside', () => {
		expect(segmentIntersectsRect([20, 20], [80, 80], RECT)).toBe(true);
	});

	it('is false for a segment parallel to and outside an edge', () => {
		expect(segmentIntersectsRect([-10, -10], [-10, 110], RECT)).toBe(false);
	});
});
