import { describe, expect, it } from 'vitest';
import type { Bbox } from '../geo/bbox';
import { buildProjection } from '../geo/projection';
import { visibleAt, zoomForProjection } from './detail';

describe('zoomForProjection', () => {
	it('increases as the framed bbox narrows (deeper zoom for a tighter frame)', () => {
		const wide: Bbox = [0, 0, 40, 40];
		const narrow: Bbox = [0, 0, 0.4, 0.4];
		const wideZoom = zoomForProjection(buildProjection(1000, 1000, wide, 20));
		const narrowZoom = zoomForProjection(buildProjection(1000, 1000, narrow, 20));

		expect(narrowZoom).toBeGreaterThan(wideZoom);
	});

	it('increases by 1 when scale doubles', () => {
		const bbox: Bbox = [0, 0, 10, 10];
		const z1 = zoomForProjection(buildProjection(1000, 1000, bbox, 20));
		const z2 = zoomForProjection(buildProjection(2000, 2000, bbox, 40));

		expect(z2).toBeCloseTo(z1 + 1, 5);
	});
});

describe('visibleAt', () => {
	it('always shows features with no min_zoom tag', () => {
		expect(visibleAt(null, 0, 'minimal')).toBe(true);
		expect(visibleAt(undefined, 20, 'minimal')).toBe(true);
	});

	it('hides a feature whose min_zoom has not been reached', () => {
		expect(visibleAt(10, 5, 'balanced')).toBe(false);
	});

	it('shows a feature once its min_zoom is reached', () => {
		expect(visibleAt(5, 5, 'balanced')).toBe(true);
		expect(visibleAt(5, 10, 'balanced')).toBe(true);
	});

	it('rich bias shows features earlier than balanced', () => {
		expect(visibleAt(6, 5, 'balanced')).toBe(false);
		expect(visibleAt(6, 5, 'rich')).toBe(true);
	});

	it('minimal bias hides features that balanced would already show', () => {
		expect(visibleAt(5, 5, 'balanced')).toBe(true);
		expect(visibleAt(5, 5, 'minimal')).toBe(false);
	});
});
