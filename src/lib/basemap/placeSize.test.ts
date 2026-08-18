import { describe, expect, it } from 'vitest';
import { CITY_SIZE_MAX, POPULATION_FLOORS, populationLabel, sizeFromOsmPlace, sizeFromPopulation } from './placeSize';

describe('sizeFromPopulation', () => {
	it('lands on the documented boundary between level 0 and level 1', () => {
		expect(sizeFromPopulation(1_000_000)).toBe(0);
		expect(sizeFromPopulation(999_999)).toBe(1);
	});

	it('is monotone: larger population never yields a larger (smaller-looking) size', () => {
		const pops = [2_000_000, 600_000, 300_000, 120_000, 60_000, 30_000, 12_000, 6_000, 2_500, 1_100, 500];
		const sizes = pops.map(sizeFromPopulation);
		for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
	});

	it('places every documented floor at its own level', () => {
		POPULATION_FLOORS.forEach((floor, level) => {
			expect(sizeFromPopulation(floor)).toBe(level);
		});
	});

	it('falls to CITY_SIZE_MAX below the smallest floor', () => {
		expect(sizeFromPopulation(999)).toBe(CITY_SIZE_MAX);
	});

	it('falls to CITY_SIZE_MAX for missing or non-positive population', () => {
		expect(sizeFromPopulation(null)).toBe(CITY_SIZE_MAX);
		expect(sizeFromPopulation(undefined)).toBe(CITY_SIZE_MAX);
		expect(sizeFromPopulation(0)).toBe(CITY_SIZE_MAX);
		expect(sizeFromPopulation(-99)).toBe(CITY_SIZE_MAX);
	});
});

describe('sizeFromOsmPlace', () => {
	it('keeps class ordering: every city size is smaller than every town, village, hamlet', () => {
		const cityMax = Math.max(sizeFromOsmPlace('city', 1), sizeFromOsmPlace('city', 4), sizeFromOsmPlace('city', 99));
		const townMin = Math.min(sizeFromOsmPlace('town', 1), sizeFromOsmPlace('town', 99));
		expect(cityMax).toBeLessThan(townMin);

		const townMax = Math.max(sizeFromOsmPlace('town', 1), sizeFromOsmPlace('town', 99));
		const villageMin = Math.min(sizeFromOsmPlace('village', 1), sizeFromOsmPlace('village', 99));
		expect(townMax).toBeLessThan(villageMin);

		const villageMax = Math.max(sizeFromOsmPlace('village', 1), sizeFromOsmPlace('village', 99));
		expect(villageMax).toBeLessThan(sizeFromOsmPlace('hamlet', 1));
	});

	it('refines within a class by rank, lower rank scoring smaller (more prominent)', () => {
		expect(sizeFromOsmPlace('city', 1)).toBeLessThan(sizeFromOsmPlace('city', 99));
		expect(sizeFromOsmPlace('town', 1)).toBeLessThan(sizeFromOsmPlace('town', 99));
		expect(sizeFromOsmPlace('village', 1)).toBeLessThan(sizeFromOsmPlace('village', 99));
	});

	it('maps hamlet and any unrecognized class to CITY_SIZE_MAX', () => {
		expect(sizeFromOsmPlace('hamlet', 1)).toBe(CITY_SIZE_MAX);
		expect(sizeFromOsmPlace('suburb', 1)).toBe(CITY_SIZE_MAX);
		expect(sizeFromOsmPlace('', 99)).toBe(CITY_SIZE_MAX);
	});
});

describe('populationLabel', () => {
	it('reads out the population floor for each level', () => {
		expect(populationLabel(0)).toBe('1,000,000+');
		expect(populationLabel(9)).toBe('1,000+');
	});

	it('reads "All places" at the max', () => {
		expect(populationLabel(CITY_SIZE_MAX)).toBe('All places');
	});
});
