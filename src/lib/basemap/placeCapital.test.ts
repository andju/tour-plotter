import { describe, expect, it } from 'vitest';
import { capitalFromFeatureClass, capitalFromOsmCapital } from './placeCapital';

describe('capitalFromFeatureClass', () => {
	it('maps national-capital classes to country', () => {
		expect(capitalFromFeatureClass('Admin-0 capital')).toBe('country');
		expect(capitalFromFeatureClass('Admin-0 capital alt')).toBe('country');
	});

	it('maps first-order capital classes to region', () => {
		expect(capitalFromFeatureClass('Admin-0 region capital')).toBe('region');
		expect(capitalFromFeatureClass('Admin-1 capital')).toBe('region');
		expect(capitalFromFeatureClass('Admin-1 region capital')).toBe('region');
	});

	it('leaves an ordinary place, or a missing value, undefined', () => {
		expect(capitalFromFeatureClass('Populated place')).toBeUndefined();
		expect(capitalFromFeatureClass('Scientific station')).toBeUndefined();
		expect(capitalFromFeatureClass(null)).toBeUndefined();
		expect(capitalFromFeatureClass(undefined)).toBeUndefined();
	});
});

describe('capitalFromOsmCapital', () => {
	it('maps admin_level 2 to country and 4 to region', () => {
		expect(capitalFromOsmCapital(2)).toBe('country');
		expect(capitalFromOsmCapital(4)).toBe('region');
	});

	it('leaves deeper admin levels (county/municipal seats) undefined', () => {
		expect(capitalFromOsmCapital(5)).toBeUndefined();
		expect(capitalFromOsmCapital(6)).toBeUndefined();
	});

	it('leaves a missing value undefined', () => {
		expect(capitalFromOsmCapital(null)).toBeUndefined();
		expect(capitalFromOsmCapital(undefined)).toBeUndefined();
	});
});
