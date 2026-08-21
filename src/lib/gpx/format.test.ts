import { describe, expect, it } from 'vitest';
import { combineStats, formatStats } from './format';

describe('formatStats', () => {
	it('always includes distance', () => {
		expect(formatStats({ distanceKm: 12.34, elevationGainM: null, durationSeconds: null })).toBe('12.3 km');
	});

	it('includes elevation gain when present', () => {
		expect(formatStats({ distanceKm: 10, elevationGainM: 250.6, durationSeconds: null })).toBe(
			'10.0 km · 251 m gain'
		);
	});

	it('formats duration under an hour as minutes only', () => {
		expect(formatStats({ distanceKm: 5, elevationGainM: null, durationSeconds: 25 * 60 })).toBe('5.0 km · 25m');
	});

	it('formats duration over an hour as hours and minutes', () => {
		expect(formatStats({ distanceKm: 5, elevationGainM: null, durationSeconds: 90 * 60 })).toBe('5.0 km · 1h 30m');
	});

	it('carries a rounded minute remainder into the next hour', () => {
		expect(formatStats({ distanceKm: 5, elevationGainM: null, durationSeconds: 3590 })).toBe('5.0 km · 1h 0m');
	});

	it('carries a rounded minute remainder past an already-whole hour', () => {
		expect(formatStats({ distanceKm: 5, elevationGainM: null, durationSeconds: 7180 })).toBe('5.0 km · 2h 0m');
	});
});

describe('combineStats', () => {
	it('sums distance across tracks', () => {
		const combined = combineStats([
			{ distanceKm: 10, elevationGainM: null, durationSeconds: null },
			{ distanceKm: 15, elevationGainM: null, durationSeconds: null }
		]);
		expect(combined.distanceKm).toBeCloseTo(25);
	});

	it('treats missing elevation as 0 in the sum once any track has it', () => {
		const combined = combineStats([
			{ distanceKm: 10, elevationGainM: 100, durationSeconds: null },
			{ distanceKm: 15, elevationGainM: null, durationSeconds: null }
		]);
		expect(combined.elevationGainM).toBe(100);
	});

	it('is null for elevation when no track has any', () => {
		const combined = combineStats([{ distanceKm: 10, elevationGainM: null, durationSeconds: null }]);
		expect(combined.elevationGainM).toBeNull();
	});
});
