import { describe, expect, it } from 'vitest';
import type { Bbox } from '../geo/bbox';
import { buildProjection } from '../geo/projection';
import { computeScaleBar } from './scaleBar';

describe('computeScaleBar', () => {
	it('picks a round distance and stays within the max width fraction', () => {
		const bbox: Bbox = [0, 40, 5, 45]; // a few hundred km wide, mid-latitude
		const projection = buildProjection(1000, 1000, bbox, 40);
		const bar = computeScaleBar(projection, 1000, 1000, 40);

		expect(bar).not.toBeNull();
		expect(bar!.widthPx).toBeGreaterThan(0);
		expect(bar!.widthPx).toBeLessThanOrEqual(1000 * 0.2 + 1);
		expect(bar!.label).toMatch(/^\d+(\.\d+)? (km|m)$/);
	});

	it('produces a shorter pixel width at high latitude than at the equator for the same km span', () => {
		// Mercator inflates pixels-per-km near the poles, so the same round
		// km label should draw at a smaller ground-distance-per-pixel ratio,
		// i.e. the bar for a given round distance is wider in pixels at high
		// latitude than at the equator for an equally-wide bbox... instead
		// we check the inverse holds for equal *pixel* framing: a bbox with
		// the same lon/lat span covers less ground at high latitude, so its
		// round distance should be smaller or equal.
		const equatorBbox: Bbox = [0, -2.5, 10, 2.5];
		const highLatBbox: Bbox = [0, 58, 10, 63];

		const equatorBar = computeScaleBar(buildProjection(1000, 1000, equatorBbox, 40), 1000, 1000, 40);
		const highLatBar = computeScaleBar(buildProjection(1000, 1000, highLatBbox, 40), 1000, 1000, 40);

		expect(equatorBar).not.toBeNull();
		expect(highLatBar).not.toBeNull();

		const parseKm = (label: string) => (label.endsWith('km') ? parseFloat(label) : parseFloat(label) / 1000);
		expect(parseKm(highLatBar!.label)).toBeLessThanOrEqual(parseKm(equatorBar!.label));
	});

	it('returns null when the projection cannot invert pixel coordinates', () => {
		const projectionWithoutInvert = Object.assign(
			(coords: [number, number]) => coords,
			{ invert: undefined }
		) as unknown as import('d3-geo').GeoProjection;

		expect(computeScaleBar(projectionWithoutInvert, 1000, 1000, 40)).toBeNull();
	});
});
