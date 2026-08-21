import { beforeEach, describe, expect, it } from 'vitest';
import type { Bbox } from '../geo/bbox';
import { clearBasemapCaches, loadBasemap } from './loadBasemap';

const BERLIN: Bbox = [13.3, 52.45, 13.5, 52.55];

function emptyCollection(): GeoJSON.FeatureCollection {
	return { type: 'FeatureCollection', features: [] };
}

/** Stubs the 8 static-file fetches `loadNaturalEarth` issues per call. */
function stubNaturalEarthFetch(failCallIndex?: number): { fn: typeof fetch; calls: number } {
	const stub = { calls: 0 } as { fn: typeof fetch; calls: number };
	stub.fn = (async () => {
		const index = stub.calls;
		stub.calls++;
		if (index === failCallIndex) {
			return { ok: false, status: 500, statusText: 'Internal Server Error' } as Response;
		}
		return { ok: true, json: async () => emptyCollection() } as Response;
	}) as typeof fetch;
	return stub;
}

/** Stubs the OpenFreeMap TileJSON + tile fetches `loadOsmTiles` issues. */
function stubOsmFetch(): { fn: typeof fetch; tileUrls: string[] } {
	const stub = { tileUrls: [] as string[] } as { fn: typeof fetch; tileUrls: string[] };
	stub.fn = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/planet') && !url.endsWith('.pbf')) {
			return {
				ok: true,
				json: async () => ({ tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'] })
			} as Response;
		}
		stub.tileUrls.push(url);
		return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
	}) as typeof fetch;
	return stub;
}

describe('loadBasemap caching', () => {
	beforeEach(() => clearBasemapCaches());

	it('fetches natural-earth data once across repeated calls', async () => {
		const stub = stubNaturalEarthFetch();

		await loadBasemap('natural-earth', BERLIN, 10, stub.fn);
		const afterFirst = stub.calls;
		expect(afterFirst).toBeGreaterThan(0);

		await loadBasemap('natural-earth', BERLIN, 10, stub.fn);

		expect(stub.calls).toBe(afterFirst);
	});

	it('leaves the natural-earth cache empty after a failed fetch so a retry re-fetches', async () => {
		const stub = stubNaturalEarthFetch(0);

		await expect(loadBasemap('natural-earth', BERLIN, 10, stub.fn)).rejects.toThrow();
		const afterFailedRound = stub.calls;

		await expect(loadBasemap('natural-earth', BERLIN, 10, stub.fn)).resolves.toBeDefined();

		expect(stub.calls).toBe(afterFailedRound * 2);
	});

	it('clearBasemapCaches also clears the OSM tile cache', async () => {
		const stub = stubOsmFetch();

		await loadBasemap('osm', BERLIN, 10, stub.fn);
		const afterFirst = stub.tileUrls.length;
		expect(afterFirst).toBeGreaterThan(0);

		clearBasemapCaches();
		await loadBasemap('osm', BERLIN, 10, stub.fn);

		expect(stub.tileUrls.length).toBe(afterFirst * 2);
	});
});
