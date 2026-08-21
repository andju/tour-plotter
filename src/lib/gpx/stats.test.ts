import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';
import type { Track, TrackPoint } from './types';

function point(lon: number, lat: number, ele: number | null = null, time: string | null = null): TrackPoint {
	return { lon, lat, ele, time };
}

function track(segments: TrackPoint[][]): Track {
	return {
		id: 't',
		name: 'test',
		segments,
		style: { color: '#000', widthPx: 2, opacity: 1, visible: true }
	};
}

// Haversine reference, independent of the turf implementation under test.
function haversineKm(a: TrackPoint, b: TrackPoint): number {
	const R = 6371;
	const dLat = ((b.lat - a.lat) * Math.PI) / 180;
	const dLon = ((b.lon - a.lon) * Math.PI) / 180;
	const lat1 = (a.lat * Math.PI) / 180;
	const lat2 = (b.lat * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

describe('computeStats — distance', () => {
	it('matches an independent haversine calculation for a known two-point track', () => {
		const a = point(13.405, 52.52);
		const b = point(13.41, 52.525);
		const stats = computeStats(track([[a, b]]));

		expect(stats.distanceKm).toBeCloseTo(haversineKm(a, b), 3);
	});

	it('does not count the gap between segments as distance', () => {
		const nearby = track([
			[point(0, 0), point(0, 0.001)],
			[point(0, 0.002), point(0, 0.003)]
		]);
		const farApart = track([
			[point(0, 0), point(0, 0.001)],
			[point(50, 50), point(50, 50.001)]
		]);

		// Only the two in-segment hops count in either case, so despite the
		// segments being on opposite sides of the globe, distance matches.
		expect(computeStats(farApart).distanceKm).toBeCloseTo(computeStats(nearby).distanceKm, 5);
	});
});

describe('computeStats — elevation gain', () => {
	it('is null when the track has no elevation data', () => {
		const t = track([[point(0, 0), point(0, 1)]]);
		expect(computeStats(t).elevationGainM).toBeNull();
	});

	it('stays near zero for a flat but GPS-noisy track', () => {
		const elevations = [100, 102, 99, 101, 98, 103, 100, 99, 101, 100];
		const t = track([elevations.map((e, i) => point(0, i * 0.001, e))]);

		expect(computeStats(t).elevationGainM).toBeLessThan(5);
	});

	it('counts a real sustained climb', () => {
		// 0 -> 100m over 10 steps, well past the noise threshold.
		const elevations = Array.from({ length: 11 }, (_, i) => i * 10);
		const t = track([elevations.map((e, i) => point(0, i * 0.001, e))]);

		expect(computeStats(t).elevationGainM).toBeCloseTo(100, 0);
	});

	it('ignores a small dip that stays within the noise threshold', () => {
		// Climbs to 20, dips 3m (within threshold), continues to 40.
		const elevations = [0, 10, 20, 17, 30, 40];
		const t = track([elevations.map((e, i) => point(0, i * 0.001, e))]);

		expect(computeStats(t).elevationGainM).toBeCloseTo(40, 0);
	});

	it('sums gain across segments', () => {
		const t = track([
			[point(0, 0, 0), point(0, 0.001, 20)],
			[point(0, 0.002, 20), point(0, 0.003, 40)]
		]);

		expect(computeStats(t).elevationGainM).toBeCloseTo(40, 0);
	});
});

describe('computeStats — duration', () => {
	it('is null when the track has no timestamps', () => {
		const t = track([[point(0, 0), point(0, 1)]]);
		expect(computeStats(t).durationSeconds).toBeNull();
	});

	it('computes elapsed seconds for a single segment', () => {
		const t = track([
			[point(0, 0, null, '2026-01-01T08:00:00Z'), point(0, 1, null, '2026-01-01T08:00:30Z')]
		]);

		expect(computeStats(t).durationSeconds).toBe(30);
	});

	it('sums per-segment duration, excluding the gap between segments', () => {
		const t = track([
			[point(0, 0, null, '2026-01-01T08:00:00Z'), point(0, 1, null, '2026-01-01T08:00:10Z')],
			// large gap here (a pause) that should NOT be counted
			[point(0, 2, null, '2026-01-01T09:00:00Z'), point(0, 3, null, '2026-01-01T09:00:20Z')]
		]);

		expect(computeStats(t).durationSeconds).toBe(30);
	});

	it('ignores a segment whose timestamps run backwards', () => {
		const t = track([
			[point(0, 0, null, '2026-01-01T08:00:30Z'), point(0, 1, null, '2026-01-01T08:00:00Z')]
		]);

		expect(computeStats(t).durationSeconds).toBeNull();
	});
});
