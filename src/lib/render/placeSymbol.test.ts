import { describe, expect, it } from 'vitest';
import { placeSymbol } from './placeSymbol';

const RADII = [6, 4.5, 3.2, 2.2, 1.5];
const FONT_SIZES = [13, 11.5, 10, 9, 8.5];

describe('placeSymbol', () => {
	it('draws an ordinary place as a circle sized by its class', () => {
		const symbol = placeSymbol([10, 10], 0, undefined, RADII, FONT_SIZES);
		expect(symbol.shape).toBe('circle');
		expect(symbol.drawRadiusPx).toBe(RADII[0]);
		expect(symbol.anchorRadiusPx).toBe(RADII[0]);
		expect(symbol.fontSizePx).toBe(FONT_SIZES[0]);
		expect(symbol.starPoints).toHaveLength(0);
	});

	it('draws a region capital as a square', () => {
		const symbol = placeSymbol([10, 10], 4, 'region', RADII, FONT_SIZES);
		expect(symbol.shape).toBe('square');
		expect(symbol.drawRadiusPx).toBeGreaterThan(0);
		expect(symbol.drawRadiusPx).toBeLessThan(RADII[2]);
		expect(symbol.anchorRadiusPx).toBeGreaterThan(symbol.drawRadiusPx);
	});

	it('draws a country capital as a star, close in size to the circle it replaces', () => {
		const symbol = placeSymbol([10, 10], 0, 'country', RADII, FONT_SIZES);
		expect(symbol.shape).toBe('star');
		expect(symbol.anchorRadiusPx).toBeGreaterThan(RADII[0]);
		expect(symbol.anchorRadiusPx).toBeLessThan(RADII[0] * 1.5);
	});

	it('the star has 10 points (5 outer, 5 inner) centered on the anchor', () => {
		const symbol = placeSymbol([100, 200], 0, 'country', RADII, FONT_SIZES);
		expect(symbol.starPoints).toHaveLength(10);
		const centroidX = symbol.starPoints.reduce((sum, p) => sum + p[0], 0) / symbol.starPoints.length;
		const centroidY = symbol.starPoints.reduce((sum, p) => sum + p[1], 0) / symbol.starPoints.length;
		expect(centroidX).toBeCloseTo(100, 5);
		expect(centroidY).toBeCloseTo(200, 5);
	});

	it('the star points up: its topmost vertex is directly above the anchor', () => {
		const symbol = placeSymbol([100, 200], 0, 'country', RADII, FONT_SIZES);
		const top = symbol.starPoints.reduce((a, b) => (b[1] < a[1] ? b : a));
		expect(top[0]).toBeCloseTo(100, 5);
	});

	it('a larger class (lower index) yields a larger symbol than a smaller class, for every shape', () => {
		expect(placeSymbol([0, 0], 0, undefined, RADII, FONT_SIZES).drawRadiusPx).toBeGreaterThan(
			placeSymbol([0, 0], 9, undefined, RADII, FONT_SIZES).drawRadiusPx
		);
		expect(placeSymbol([0, 0], 0, 'region', RADII, FONT_SIZES).drawRadiusPx).toBeGreaterThan(
			placeSymbol([0, 0], 9, 'region', RADII, FONT_SIZES).drawRadiusPx
		);
		expect(placeSymbol([0, 0], 0, 'country', RADII, FONT_SIZES).anchorRadiusPx).toBeGreaterThan(
			placeSymbol([0, 0], 9, 'country', RADII, FONT_SIZES).anchorRadiusPx
		);
	});

	it('two places in the same size class draw identical symbols', () => {
		const a = placeSymbol([0, 0], 0, undefined, RADII, FONT_SIZES);
		const b = placeSymbol([0, 0], 1, undefined, RADII, FONT_SIZES);
		expect(a.drawRadiusPx).toBe(b.drawRadiusPx);
		expect(a.fontSizePx).toBe(b.fontSizePx);
	});
});
