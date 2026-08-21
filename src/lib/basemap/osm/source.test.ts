import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bbox } from '../../geo/bbox';
import { clearOsmCaches, loadOsmTiles } from './source';

/**
 * A zero-byte protobuf decodes to a tile with no layers, which is all these
 * tests need — they're about how often the network is touched, not about
 * what comes back from it.
 */
function emptyTile(): ArrayBuffer {
	return new ArrayBuffer(0);
}

interface StubFetch {
	fn: typeof fetch;
	tileUrls: string[];
	failNext: Set<string>;
}

function stubFetch(): StubFetch {
	const stub: StubFetch = {
		tileUrls: [],
		failNext: new Set(),
		fn: (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/planet') && !url.endsWith('.pbf')) {
				return {
					ok: true,
					json: async () => ({ tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'] })
				} as Response;
			}
			stub.tileUrls.push(url);
			if (stub.failNext.has(url)) {
				stub.failNext.delete(url);
				return { ok: false, status: 503, statusText: 'Service Unavailable' } as Response;
			}
			return { ok: true, arrayBuffer: async () => emptyTile() } as Response;
		}) as typeof fetch
	};
	return stub;
}

const BERLIN: Bbox = [13.3, 52.45, 13.5, 52.55];

describe('loadOsmTiles caching', () => {
	beforeEach(() => clearOsmCaches());

	it('does not refetch tiles when the same framing is requested again', async () => {
		const stub = stubFetch();

		await loadOsmTiles(BERLIN, 10, stub.fn);
		const afterFirst = stub.tileUrls.length;
		expect(afterFirst).toBeGreaterThan(0);

		await loadOsmTiles(BERLIN, 10, stub.fn);

		expect(stub.tileUrls).toHaveLength(afterFirst);
	});

	it('reuses tiles shared with an overlapping frame instead of refetching them', async () => {
		const stub = stubFetch();

		await loadOsmTiles(BERLIN, 10, stub.fn);
		const first = new Set(stub.tileUrls);
		stub.tileUrls.length = 0;

		// A slightly wider frame at the same zoom: some tiles are new, but
		// every tile of the original cover is already in hand.
		await loadOsmTiles([13.2, 52.4, 13.7, 52.6], 10, stub.fn);

		for (const url of stub.tileUrls) {
			expect(first.has(url)).toBe(false);
		}
	});

	it('issues one fetch per tile when the same cover is requested concurrently', async () => {
		const stub = stubFetch();

		await Promise.all([
			loadOsmTiles(BERLIN, 10, stub.fn),
			loadOsmTiles(BERLIN, 10, stub.fn),
			loadOsmTiles(BERLIN, 10, stub.fn)
		]);

		expect(new Set(stub.tileUrls).size).toBe(stub.tileUrls.length);
	});

	it('does not cache a failed tile, so a retry can succeed', async () => {
		const probe = stubFetch();
		await loadOsmTiles(BERLIN, 10, probe.fn);
		const [firstTileUrl] = probe.tileUrls;
		clearOsmCaches();

		const stub = stubFetch();
		stub.failNext.add(firstTileUrl);

		await expect(loadOsmTiles(BERLIN, 10, stub.fn)).rejects.toThrow(/Failed to load tile/);

		const layers = await loadOsmTiles(BERLIN, 10, stub.fn);

		expect(layers.attribution).toContain('OpenStreetMap');
	});

	it('rejects with a timeout message instead of hanging when a tile never responds', async () => {
		vi.useFakeTimers();
		try {
			const stub = stubFetch();
			const hungUrl = 'https://tiles.example/10/550/335.pbf';
			const base = stub.fn;
			stub.fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) === hungUrl) {
					return new Promise<Response>((_, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('The operation timed out.', 'TimeoutError'))
						);
					});
				}
				return base(input, init as RequestInit);
			}) as typeof fetch;

			const result = expect(loadOsmTiles(BERLIN, 10, stub.fn)).rejects.toThrow(/Timed out/);
			await vi.advanceTimersByTimeAsync(15_000);
			await result;
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not cache a timed-out tile, so a retry can succeed', async () => {
		vi.useFakeTimers();
		try {
			const stub = stubFetch();
			const hungUrl = 'https://tiles.example/10/550/335.pbf';
			const base = stub.fn;
			let hang = true;
			stub.fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (hang && String(input) === hungUrl) {
					return new Promise<Response>((_, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('The operation timed out.', 'TimeoutError'))
						);
					});
				}
				return base(input, init as RequestInit);
			}) as typeof fetch;

			const result = expect(loadOsmTiles(BERLIN, 10, stub.fn)).rejects.toThrow(/Timed out/);
			await vi.advanceTimersByTimeAsync(15_000);
			await result;

			hang = false;
			const layers = await loadOsmTiles(BERLIN, 10, stub.fn);
			expect(layers.attribution).toContain('OpenStreetMap');
		} finally {
			vi.useRealTimers();
		}
	});
});
