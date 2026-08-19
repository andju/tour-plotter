import { geoPath } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import type { Bbox } from './bbox';
import { buildProjection, projectedAspect, visibleBbox } from './projection';

const berlin: Bbox = [13.0, 52.0, 13.5, 52.5];

function projectedCorners(bbox: Bbox, width: number, height: number, margin: number) {
	const [minLon, minLat, maxLon, maxLat] = bbox;
	const projection = buildProjection(width, height, bbox, margin);
	return [
		[minLon, minLat],
		[maxLon, minLat],
		[maxLon, maxLat],
		[minLon, maxLat]
	].map((c) => projection(c as [number, number])!);
}

describe('buildProjection', () => {
	it.each([
		['portrait', 800, 1200],
		['landscape', 1200, 800],
		['square', 1000, 1000]
	])('fits the full bbox within the canvas for a %s target', (_label, width, height) => {
		const margin = 20;
		const corners = projectedCorners(berlin, width, height, margin);

		for (const [x, y] of corners) {
			expect(x).toBeGreaterThanOrEqual(margin - 0.5);
			expect(x).toBeLessThanOrEqual(width - margin + 0.5);
			expect(y).toBeGreaterThanOrEqual(margin - 0.5);
			expect(y).toBeLessThanOrEqual(height - margin + 0.5);
		}
	});

	it('touches the margin boundary on the constraining axis', () => {
		// bbox is wider than tall, target is exactly as wide as tall ->
		// the fit is constrained by width, so the left/right margins should
		// be hit almost exactly.
		const wideBbox: Bbox = [0, 0, 10, 1];
		const margin = 20;
		const corners = projectedCorners(wideBbox, 1000, 1000, margin);
		const xs = corners.map((c) => c[0]);

		expect(Math.min(...xs)).toBeCloseTo(margin, 0);
		expect(Math.max(...xs)).toBeCloseTo(1000 - margin, 0);
	});

	it('scales linearly when resolution and margin double together', () => {
		const p1 = buildProjection(1000, 1000, berlin, 20);
		const p2 = buildProjection(2000, 2000, berlin, 40);

		expect(p2.scale()).toBeCloseTo(p1.scale() * 2, 5);
	});

	it('handles an antimeridian-wrapped bbox without collapsing to zero size', () => {
		const wrapped: Bbox = [170, -5, -170, 5];
		const width = 800;
		const height = 600;
		const margin = 20;

		const projection = buildProjection(width, height, wrapped, margin);
		const path = geoPath(projection);
		const rect: GeoJSON.Polygon = {
			type: 'Polygon',
			coordinates: [
				[
					[170, -5],
					[-170, -5],
					[-170, 5],
					[170, 5],
					[170, -5]
				]
			]
		};
		const [[x0, y0], [x1, y1]] = path.bounds(rect);

		expect(x1 - x0).toBeGreaterThan(width * 0.5);
		expect(y1 - y0).toBeGreaterThan(height * 0.5);
	});
});

describe('visibleBbox', () => {
	it('extends beyond the bbox on the non-constraining axis (letterboxing)', () => {
		// Wide, flat bbox fit into a square canvas: width is the binding
		// constraint, so the visible latitude range must reach past the
		// bbox's own min/max lat to fill the full canvas height.
		const wideBbox: Bbox = [0, 40, 20, 41];
		const margin = 20;
		const projection = buildProjection(1000, 1000, wideBbox, margin);

		const [minLon, minLat, maxLon, maxLat] = visibleBbox(projection, 1000, 1000);

		expect(minLat).toBeLessThan(wideBbox[1]);
		expect(maxLat).toBeGreaterThan(wideBbox[3]);
		// Longitude is the binding axis, so it should stay close to the bbox
		// (only the margin's worth of extra space beyond it).
		expect(minLon).toBeGreaterThan(wideBbox[0] - 1);
		expect(maxLon).toBeLessThan(wideBbox[2] + 1);
	});

	it('extends beyond the bbox on the non-constraining axis when height binds', () => {
		const tallBbox: Bbox = [10, 40, 11, 60];
		const margin = 20;
		const projection = buildProjection(1000, 1000, tallBbox, margin);

		const [minLon, minLat, maxLon, maxLat] = visibleBbox(projection, 1000, 1000);

		expect(minLon).toBeLessThan(tallBbox[0]);
		expect(maxLon).toBeGreaterThan(tallBbox[2]);
		expect(minLat).toBeGreaterThan(tallBbox[1] - 1);
		expect(maxLat).toBeLessThan(tallBbox[3] + 1);
	});

	it('covers the original bbox (plus margin) at minimum', () => {
		const projection = buildProjection(800, 600, berlin, 20);
		const [minLon, minLat, maxLon, maxLat] = visibleBbox(projection, 800, 600);

		expect(minLon).toBeLessThanOrEqual(berlin[0]);
		expect(minLat).toBeLessThanOrEqual(berlin[1]);
		expect(maxLon).toBeGreaterThanOrEqual(berlin[2]);
		expect(maxLat).toBeGreaterThanOrEqual(berlin[3]);
	});

	it('keeps the wrap convention for an antimeridian-crossing view', () => {
		const wrapped: Bbox = [170, -5, -170, 5];
		const projection = buildProjection(800, 600, wrapped, 20);
		const [minLon, , maxLon] = visibleBbox(projection, 800, 600);

		// A visible range that itself straddles +-180 must report
		// minLon > maxLon, matching this app's Bbox convention.
		expect(minLon).toBeGreaterThan(maxLon);
	});
});

describe('projectedAspect', () => {
	it('agrees with the aspect ratio buildProjection actually fits (equatorial bbox)', () => {
		// A tall, narrow bbox at the equator: no latitude distortion to speak
		// of, so its projected aspect should sit close to its plain lon/lat
		// aspect ratio (height 10deg / width 1deg = 10).
		const tallEquatorial: Bbox = [0, -5, 1, 5];
		expect(projectedAspect(tallEquatorial)).toBeCloseTo(10, 0);
	});

	it('reports a taller aspect for a bbox nearer the pole than an identical-span bbox at the equator', () => {
		// Same lon/lat span (10deg x 10deg) at two latitudes — Mercator's
		// poleward y-stretch should make the high-latitude one measure taller.
		const equatorial: Bbox = [0, -5, 10, 5];
		const highLatitude: Bbox = [0, 55, 10, 65];
		expect(projectedAspect(highLatitude)).toBeGreaterThan(projectedAspect(equatorial));
	});

	it('is self-consistent with buildProjection: fitting a canvas of that aspect ratio binds both axes equally', () => {
		const bbox: Bbox = [10, 40, 11, 60];
		const aspect = projectedAspect(bbox);
		const width = 800;
		const height = width * aspect;
		const margin = 0;

		const corners = projectedCorners(bbox, width, height, margin);
		const xs = corners.map((c) => c[0]);
		const ys = corners.map((c) => c[1]);

		// With a canvas cut exactly to the bbox's own projected aspect ratio,
		// neither axis has slack — both the horizontal and vertical spans
		// should reach (within rounding) the full width/height.
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(width, 0);
		expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(height, 0);
	});
});
