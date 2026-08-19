import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_COLORS, TRACK_COLORS, normalizeHex } from './trackColors';
import { defaultStyle } from './types';

const HEX_COLOR = /^#[0-9a-f]{6}$/;

describe('TRACK_COLORS', () => {
	it('is all valid, unique, lowercase hex colors', () => {
		for (const c of TRACK_COLORS) expect(c.hex).toMatch(HEX_COLOR);
		const hexes = TRACK_COLORS.map((c) => c.hex);
		expect(new Set(hexes).size).toBe(hexes.length);
	});
});

describe('DEFAULT_TRACK_COLORS', () => {
	it('is all valid, unique, lowercase hex colors', () => {
		for (const hex of DEFAULT_TRACK_COLORS) expect(hex).toMatch(HEX_COLOR);
		expect(new Set(DEFAULT_TRACK_COLORS).size).toBe(DEFAULT_TRACK_COLORS.length);
	});

	it('is a subset of TRACK_COLORS', () => {
		const swatchHexes = new Set(TRACK_COLORS.map((c) => c.hex));
		for (const hex of DEFAULT_TRACK_COLORS) expect(swatchHexes.has(hex)).toBe(true);
	});
});

describe('defaultStyle', () => {
	it('cycles through the default track colors', () => {
		const n = DEFAULT_TRACK_COLORS.length;
		expect(defaultStyle(0).color).toBe(defaultStyle(n).color);

		const firstCycle = Array.from({ length: n }, (_, i) => defaultStyle(i).color);
		expect(new Set(firstCycle).size).toBe(n);
	});
});

describe('normalizeHex', () => {
	it('accepts 3-digit hex, with or without #, any case', () => {
		expect(normalizeHex('#FFF')).toBe('#ffffff');
		expect(normalizeHex('fff')).toBe('#ffffff');
	});

	it('accepts 6-digit hex, with or without #, any case', () => {
		expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
		expect(normalizeHex('aabbcc')).toBe('#aabbcc');
	});

	it('rejects invalid input', () => {
		expect(normalizeHex('')).toBeNull();
		expect(normalizeHex('#12')).toBeNull();
		expect(normalizeHex('#12345')).toBeNull();
		expect(normalizeHex('#gggggg')).toBeNull();
		expect(normalizeHex('red')).toBeNull();
		expect(normalizeHex('#aabbccdd')).toBeNull();
	});
});
