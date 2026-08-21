import { describe, expect, it } from 'vitest';
import { sanitiseFilename } from './download';

describe('sanitiseFilename', () => {
	it('leaves a plain filename unchanged', () => {
		expect(sanitiseFilename('tour.png')).toBe('tour.png');
	});

	it('replaces path separators', () => {
		expect(sanitiseFilename('a/b/c.gpx')).toBe('a_b_c.gpx');
		expect(sanitiseFilename('a\\b.png')).toBe('a_b.png');
	});

	it('falls back to the default when nothing survives', () => {
		expect(sanitiseFilename('....')).toBe('map');
		expect(sanitiseFilename('   ')).toBe('map');
	});
});
