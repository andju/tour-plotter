import { put } from '../boundedCache';
import type { Font } from './renderer';

let sharedCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
	if (!sharedCtx) {
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) throw new Error('2D canvas context unavailable for text measurement');
		sharedCtx = ctx;
	}
	return sharedCtx;
}

// Keyed on every input that affects the result, so a cache hit is exact.
// Two very different consumers feed this: city labels, drawn from a small
// fixed basemap vocabulary, and the live-typed markdown title (measured via
// richTextLayout on every keystroke — see scene.ts:136-151). The title is
// unbounded user input, so entries are capped and evicted oldest-first
// rather than left to grow for the life of the session.
export const MAX_MEASURE_CACHE_ENTRIES = 1000;
const widthCache = new Map<string, number>();

/**
 * The single source of text width truth for both renderers — SVG has no
 * measurement API of its own, so both CanvasRenderer and label layout
 * measure through this same offscreen Canvas 2D context. Browser-only;
 * pure algorithms that need measurement (e.g. render/labels.ts) take a
 * measurement function as a parameter instead of importing this directly,
 * so they stay unit-testable without a canvas. Memoised: drawPlaces
 * re-measures the same handful of city labels on every 'overlay' redraw
 * (city size, label language, detail bias), and ctx.measureText is the
 * expensive part of that.
 */
export function measureTextWidth(value: string, font: Font): number {
	const key = `${font.style ?? 'normal'}|${font.weight ?? 'normal'}|${font.sizePx}|${font.family}|${value}`;
	const cached = widthCache.get(key);
	if (cached !== undefined) return cached;

	const ctx = getMeasureContext();
	ctx.font = `${font.style ?? 'normal'} ${font.weight ?? 'normal'} ${font.sizePx}px ${font.family}`;
	const width = ctx.measureText(value).width;
	put(widthCache, key, width, MAX_MEASURE_CACHE_ENTRIES);
	return width;
}

/** Test seam — asserts the cache stays bounded. */
export function measureCacheSize(): number {
	return widthCache.size;
}
