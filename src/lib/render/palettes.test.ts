import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE_STYLE } from './defaultStyle';
import { DEFAULT_MAP_STYLE, MAP_STYLES, sceneStyleFor, type MapStyleId } from './palettes';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const COLOR_KEYS = [
	'backgroundFill',
	'landFill',
	'coastlineStroke',
	'waterFill',
	'waterStroke',
	'waterwayStroke',
	'urbanFill',
	'parkFill',
	'admin0Stroke',
	'admin1Stroke',
	'cityDotFill',
	'textColor',
	'textHalo',
	'trackCasing',
	'scaleBarColor'
] as const;

describe('MAP_STYLES', () => {
	it('has unique ids', () => {
		const ids = MAP_STYLES.map((option) => option.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('includes the default style id', () => {
		expect(MAP_STYLES.some((option) => option.id === DEFAULT_MAP_STYLE)).toBe(true);
	});

	it('every palette carries every SceneStyle colour field as a valid hex colour', () => {
		for (const option of MAP_STYLES) {
			for (const key of COLOR_KEYS) {
				expect(option.style[key], `${option.id}.${key}`).toMatch(HEX_COLOR);
			}
		}
	});

	it('every palette shares the reference scale fields with DEFAULT_SCENE_STYLE', () => {
		for (const option of MAP_STYLES) {
			expect(option.style.referenceStrokeWidthPx).toEqual(DEFAULT_SCENE_STYLE.referenceStrokeWidthPx);
			expect(option.style.referenceCityDotRadiusPx).toEqual(DEFAULT_SCENE_STYLE.referenceCityDotRadiusPx);
			expect(option.style.referenceFontSizePx).toEqual(DEFAULT_SCENE_STYLE.referenceFontSizePx);
			expect(option.style.fontFamily).toBe(DEFAULT_SCENE_STYLE.fontFamily);
		}
	});

	it('the classic style is DEFAULT_SCENE_STYLE verbatim', () => {
		const classic = MAP_STYLES.find((option) => option.id === 'classic');
		expect(classic?.style).toBe(DEFAULT_SCENE_STYLE);
	});
});

describe('sceneStyleFor', () => {
	it('returns the matching palette for a known id', () => {
		expect(sceneStyleFor('dark')).toBe(MAP_STYLES.find((option) => option.id === 'dark')?.style);
	});

	it('falls back to the classic palette for an unknown id', () => {
		expect(sceneStyleFor('not-a-real-style' as MapStyleId)).toBe(DEFAULT_SCENE_STYLE);
	});
});
