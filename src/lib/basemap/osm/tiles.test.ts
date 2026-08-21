import { describe, expect, it } from 'vitest';
import type { Bbox } from '../../geo/bbox';
import { tilesForBbox } from './tiles';

describe('tilesForBbox', () => {
	it('covers a small bbox with a single tile at a coarse zoom', () => {
		const tiny: Bbox = [13.0, 52.0, 13.001, 52.001];
		const tiles = tilesForBbox(tiny, 4);

		expect(tiles).toHaveLength(1);
		expect(tiles[0].z).toBe(4);
	});

	it('returns tiles all at the same zoom', () => {
		const bbox: Bbox = [13.0, 52.0, 13.5, 52.5];
		const tiles = tilesForBbox(bbox, 8);

		const zooms = new Set(tiles.map((t) => t.z));
		expect(zooms.size).toBe(1);
	});

	it('clamps the requested zoom to the source maximum of 14', () => {
		const tiny: Bbox = [13.0, 52.0, 13.0001, 52.0001];
		const tiles = tilesForBbox(tiny, 20);

		expect(tiles.every((t) => t.z <= 14)).toBe(true);
	});

	it('steps the zoom down to stay within the 32-tile cap for a wide frame', () => {
		const world: Bbox = [-180, -85, 180, 85];
		const tiles = tilesForBbox(world, 10);

		expect(tiles.length).toBeLessThanOrEqual(32);
		expect(tiles[0].z).toBeLessThan(10);
	});

	it('produces adjacent tiles on both sides of an antimeridian-crossing bbox', () => {
		// wraps through 180°; at zoom 2 (n=4) this should cover the tile
		// just west of the seam (x=3) and just east of it (x=0).
		const wrapped: Bbox = [179, -1, -179, 1];
		const tiles = tilesForBbox(wrapped, 2);

		const xs = new Set(tiles.map((t) => t.x));
		expect(xs.has(3)).toBe(true);
		expect(xs.has(0)).toBe(true);
	});

	it('never returns duplicate tile coordinates', () => {
		const bbox: Bbox = [-180, -85, 180, 85];
		const tiles = tilesForBbox(bbox, 6);
		const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));

		expect(keys.size).toBe(tiles.length);
	});

	it('throws on an inverted latitude range instead of returning an empty cover', () => {
		const inverted: Bbox = [10, 60, 11, 50];
		expect(() => tilesForBbox(inverted, 10)).toThrow();
	});
});
