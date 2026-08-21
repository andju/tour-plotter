import { beforeEach, describe, expect, it } from 'vitest';
import { clearCountriesCache, loadCountries } from './countries';

function stubFetch(responses: Array<'ok' | 'fail'>): { fn: typeof fetch; calls: number } {
	const stub = { calls: 0 } as { fn: typeof fetch; calls: number };
	stub.fn = (async () => {
		const outcome = responses[stub.calls] ?? 'ok';
		stub.calls++;
		if (outcome === 'fail') {
			return { ok: false, status: 500, statusText: 'Internal Server Error' } as Response;
		}
		return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) } as Response;
	}) as typeof fetch;
	return stub;
}

describe('loadCountries caching', () => {
	beforeEach(() => clearCountriesCache());

	it('fetches once across repeated calls', async () => {
		const stub = stubFetch(['ok']);

		await loadCountries(stub.fn);
		await loadCountries(stub.fn);

		expect(stub.calls).toBe(1);
	});

	it('leaves the cache empty after a failed fetch so a retry re-fetches', async () => {
		const stub = stubFetch(['fail', 'ok']);

		await expect(loadCountries(stub.fn)).rejects.toThrow();
		await expect(loadCountries(stub.fn)).resolves.toEqual({ type: 'FeatureCollection', features: [] });

		expect(stub.calls).toBe(2);
	});
});
