import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MEASURE_CACHE_ENTRIES, measureCacheSize, measureTextWidth } from './measure';

// jsdom has no Canvas 2D context, so stub the offscreen canvas measureText
// relies on. Width is deterministic (text length) — good enough to prove
// caching/eviction behavior without a real renderer.
beforeEach(() => {
	const fakeCtx = {
		font: '',
		measureText: (text: string) => ({ width: text.length })
	} as unknown as CanvasRenderingContext2D;
	vi.spyOn(document, 'createElement').mockReturnValue({
		getContext: () => fakeCtx
	} as unknown as HTMLCanvasElement);
});

describe('measureTextWidth', () => {
	it('measures through the stubbed canvas context', () => {
		expect(measureTextWidth('abcd', { sizePx: 12, family: 'sans' })).toBe(4);
	});

	it('keeps the cache bounded under an unbounded stream of distinct strings', () => {
		for (let i = 0; i < MAX_MEASURE_CACHE_ENTRIES + 200; i++) {
			measureTextWidth(`title-draft-${i}`, { sizePx: 16, family: 'serif' });
		}
		expect(measureCacheSize()).toBeLessThanOrEqual(MAX_MEASURE_CACHE_ENTRIES);
	});
});
