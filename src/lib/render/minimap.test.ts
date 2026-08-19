import { describe, expect, it } from 'vitest';
import type { Bbox } from '../geo/bbox';
import { buildInsetProjection, minimapBbox, minimapBox, minimapMarker, type MinimapBox } from './minimap';

const berlin: Bbox = [13.0, 52.0, 13.5, 52.5];

describe('minimapBbox', () => {
	it('expands about the framing bbox center for a modest coverage', () => {
		const [minLon, minLat, maxLon, maxLat] = minimapBbox(berlin, 500);
		const centerLon = (berlin[0] + berlin[2]) / 2;
		const centerLat = (berlin[1] + berlin[3]) / 2;

		expect((minLon + maxLon) / 2).toBeCloseTo(centerLon, 1);
		expect((minLat + maxLat) / 2).toBeCloseTo(centerLat, 1);
		// 500km is well beyond Berlin's own ~35km bbox span, so it should have expanded.
		expect(maxLon - minLon).toBeGreaterThan(berlin[2] - berlin[0]);
	});

	it('clamps latitude to +-84deg at a very large coverage, never reaching the poles', () => {
		const [, minLat, , maxLat] = minimapBbox(berlin, 50000);
		expect(minLat).toBeGreaterThanOrEqual(-84);
		expect(maxLat).toBeLessThanOrEqual(84);
		expect(maxLat).toBeCloseTo(84, 5);
	});

	it('produces a bbox buildInsetProjection can still fit to a finite, sane scale at the clamp', () => {
		const bbox = minimapBbox(berlin, 50000);
		const box: MinimapBox = { x: 0, y: 0, w: 180, h: 180 };
		const projection = buildInsetProjection(box, bbox, 4);

		expect(Number.isFinite(projection.scale())).toBe(true);
		expect(projection.scale()).toBeGreaterThan(0);
	});
});

describe('minimapBox', () => {
	const outputWidth = 1000;
	const outputHeight = 800;
	const marginPx = 20;
	const widthPx = 180;

	it.each([
		['top-left', 20, 20],
		['top-right', 1000 - 20 - 180, 20]
	] as const)('positions %s at the expected corner', (position, expectedX, expectedY) => {
		const box = minimapBox(position, outputWidth, outputHeight, marginPx, widthPx, berlin);
		expect(box.x).toBeCloseTo(expectedX, 5);
		expect(box.y).toBeCloseTo(expectedY, 5);
	});

	it('centers horizontally for top-center/bottom-center', () => {
		const box = minimapBox('top-center', outputWidth, outputHeight, marginPx, widthPx, berlin);
		expect(box.x).toBeCloseTo(outputWidth / 2 - widthPx / 2, 5);
		expect(box.y).toBeCloseTo(marginPx, 5);
	});

	it('anchors to the bottom edge for bottom-* positions', () => {
		const box = minimapBox('bottom-left', outputWidth, outputHeight, marginPx, widthPx, berlin);
		expect(box.x).toBeCloseTo(marginPx, 5);
		expect(box.y).toBeCloseTo(outputHeight - marginPx - box.h, 5);
	});

	it('sizes height from the bbox aspect ratio, not a fixed square', () => {
		const wideBbox: Bbox = [0, 0, 40, 1];
		const tallBbox: Bbox = [0, 0, 1, 40];
		const wideBox = minimapBox('top-left', outputWidth, outputHeight, marginPx, widthPx, wideBbox);
		const tallBox = minimapBox('top-left', outputWidth, outputHeight, marginPx, widthPx, tallBbox);

		expect(wideBox.h).toBeLessThan(tallBox.h);
	});

	it('clamps an extreme aspect ratio so the box never balloons past a usable height', () => {
		const extremelyTall: Bbox = [0, -80, 1, 80];
		const box = minimapBox('top-left', outputWidth, outputHeight, marginPx, widthPx, extremelyTall);
		expect(box.h).toBeLessThanOrEqual(widthPx * 1.4 + 1e-6);
	});

	it('all six positions stay within the canvas bounds', () => {
		const positions = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
		for (const position of positions) {
			const box = minimapBox(position, outputWidth, outputHeight, marginPx, widthPx, berlin);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.w).toBeLessThanOrEqual(outputWidth + 1e-6);
			expect(box.y + box.h).toBeLessThanOrEqual(outputHeight + 1e-6);
		}
	});
});

describe('buildInsetProjection', () => {
	it('projects the bbox center near the box center', () => {
		// A small bbox, like `berlin` — Mercator's y is nonlinear in latitude,
		// so a wide bbox's arithmetic-mean-latitude point isn't exactly at the
		// projected midpoint; keeping the span small keeps that skew negligible.
		const box: MinimapBox = { x: 100, y: 50, w: 180, h: 180 };
		const projection = buildInsetProjection(box, berlin, 4);

		const [x, y] = projection([(berlin[0] + berlin[2]) / 2, (berlin[1] + berlin[3]) / 2])!;
		expect(x).toBeCloseTo(box.x + box.w / 2, 0);
		expect(y).toBeCloseTo(box.y + box.h / 2, 0);
	});

	it('clips geometry to the box', () => {
		const box: MinimapBox = { x: 100, y: 50, w: 180, h: 180 };
		const projection = buildInsetProjection(box, [10, 40, 20, 50], 4);
		const extent = projection.clipExtent!();
		expect(extent).toEqual([
			[box.x, box.y],
			[box.x + box.w, box.y + box.h]
		]);
	});
});

describe('minimapMarker', () => {
	const box: MinimapBox = { x: 100, y: 50, w: 180, h: 180 };

	it('returns a rect for a visible extent large enough to read as one', () => {
		const bbox: Bbox = [-10, 30, 30, 70];
		const projection = buildInsetProjection(box, bbox, 4);
		const marker = minimapMarker(projection, [0, 40, 10, 50], box, 6);

		expect(marker.kind).toBe('rect');
		if (marker.kind === 'rect') {
			expect(marker.w).toBeGreaterThan(0);
			expect(marker.h).toBeGreaterThan(0);
			expect(marker.x).toBeGreaterThanOrEqual(box.x);
			expect(marker.y).toBeGreaterThanOrEqual(box.y);
			expect(marker.x + marker.w).toBeLessThanOrEqual(box.x + box.w);
			expect(marker.y + marker.h).toBeLessThanOrEqual(box.y + box.h);
		}
	});

	it('falls back to a dot when the projected extent is too small', () => {
		// A tiny track inside a continent-wide inset — projects to a sliver.
		const bbox: Bbox = [-170, -80, 170, 80];
		const projection = buildInsetProjection(box, bbox, 4);
		const marker = minimapMarker(projection, [13.0, 52.0, 13.001, 52.001], box, 6);

		expect(marker.kind).toBe('dot');
		if (marker.kind === 'dot') {
			expect(marker.xy[0]).toBeGreaterThanOrEqual(box.x);
			expect(marker.xy[0]).toBeLessThanOrEqual(box.x + box.w);
			expect(marker.xy[1]).toBeGreaterThanOrEqual(box.y);
			expect(marker.xy[1]).toBeLessThanOrEqual(box.y + box.h);
		}
	});

	it('clamps a marker that would otherwise poke outside the box', () => {
		// The "visible" extent is wider than the inset's own framed bbox —
		// e.g. a small minimapCoverageKm with a wide main-map viewport.
		const bbox: Bbox = [0, 40, 10, 50];
		const projection = buildInsetProjection(box, bbox, 4);
		const marker = minimapMarker(projection, [-170, -80, 170, 80], box, 6);

		if (marker.kind === 'rect') {
			expect(marker.x).toBeGreaterThanOrEqual(box.x - 1e-6);
			expect(marker.y).toBeGreaterThanOrEqual(box.y - 1e-6);
			expect(marker.x + marker.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
			expect(marker.y + marker.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
		}
	});
});
