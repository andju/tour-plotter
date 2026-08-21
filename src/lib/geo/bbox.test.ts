import { describe, expect, it } from 'vitest';
import { bboxOfTracks, expandToMinimumCoverage, normalizeLon, type Bbox } from './bbox';
import type { Track, TrackPoint } from '../gpx/types';

function point(lon: number, lat: number): TrackPoint {
	return { lon, lat, ele: null, time: null };
}

function track(points: TrackPoint[]): Track {
	return { id: 't', name: 'test', segments: [points], style: { color: '#000', widthPx: 2, opacity: 1, visible: true } };
}

const KM_PER_DEG_LAT = 111.32;

describe('bboxOfTracks', () => {
	it('covers all vertices of a single track', () => {
		const t = track([point(13.0, 52.0), point(13.5, 52.0), point(13.5, 52.5), point(13.0, 52.5)]);
		const [minLon, minLat, maxLon, maxLat] = bboxOfTracks([t]);

		expect(minLon).toBeCloseTo(13.0, 3);
		expect(maxLon).toBeCloseTo(13.5, 3);
		expect(minLat).toBeCloseTo(52.0, 3);
		expect(maxLat).toBeCloseTo(52.5, 3);
	});

	it('covers the union of multiple tracks', () => {
		const a = track([point(0, 0), point(1, 1)]);
		const b = track([point(-1, -1), point(0.5, 0.5)]);
		const [minLon, minLat, maxLon, maxLat] = bboxOfTracks([a, b]);

		expect(minLon).toBeCloseTo(-1, 3);
		expect(minLat).toBeCloseTo(-1, 3);
		expect(maxLon).toBeCloseTo(1, 3);
		expect(maxLat).toBeCloseTo(1, 3);
	});
});

describe('normalizeLon', () => {
	it('keeps both antimeridian representations stable', () => {
		expect(normalizeLon(180)).toBe(180);
		expect(normalizeLon(-180)).toBe(-180);
	});
});

describe('expandToMinimumCoverage', () => {
	it('expands a small bbox up to the minimum coverage', () => {
		const small: Bbox = [13.0, 52.0, 13.01, 52.01]; // roughly 1km square
		const [minLon, minLat, maxLon, maxLat] = expandToMinimumCoverage(small, 200);

		const heightKm = (maxLat - minLat) * KM_PER_DEG_LAT;
		const centerLat = (minLat + maxLat) / 2;
		const widthKm = (maxLon - minLon) * KM_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);

		expect(heightKm).toBeCloseTo(200, 0);
		expect(widthKm).toBeCloseTo(200, 0);
	});

	it('leaves a bbox that already exceeds the minimum unchanged', () => {
		const large: Bbox = [0, 0, 10, 10]; // ~1100km square at the equator
		const [minLon, minLat, maxLon, maxLat] = expandToMinimumCoverage(large, 200);

		expect(minLon).toBeCloseTo(0, 2);
		expect(minLat).toBeCloseTo(0, 2);
		expect(maxLon).toBeCloseTo(10, 2);
		expect(maxLat).toBeCloseTo(10, 2);
	});

	it('requires a wider longitude span at high latitude for the same km coverage', () => {
		const nearPole: Bbox = [13.0, 70.0, 13.01, 70.01];
		const nearEquator: Bbox = [13.0, 0.0, 13.01, 0.01];

		const [poleMinLon, , poleMaxLon] = expandToMinimumCoverage(nearPole, 200);
		const [eqMinLon, , eqMaxLon] = expandToMinimumCoverage(nearEquator, 200);

		expect(poleMaxLon - poleMinLon).toBeGreaterThan(eqMaxLon - eqMinLon);
	});

	it('preserves an antimeridian-wrapped bbox when already wide enough', () => {
		// wraps through 180°, 20° wide (minLon > maxLon by convention)
		const wrapped: Bbox = [170, -5, -170, 5];
		const [minLon, , maxLon] = expandToMinimumCoverage(wrapped, 10);

		expect(minLon).toBeGreaterThan(maxLon); // still wrapped
	});

	it('expands symmetrically across the antimeridian when the center sits on it', () => {
		const atDateLine: Bbox = [179.99, -1, -179.99, 1]; // centered on 180°, wrapped
		const [minLon, , maxLon] = expandToMinimumCoverage(atDateLine, 500);

		expect(minLon).toBeGreaterThan(maxLon); // stays wrapped, doesn't jump to the wrong side
	});
});
