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

/**
 * The single source of text width truth for both renderers — SVG has no
 * measurement API of its own, so both CanvasRenderer and label layout
 * measure through this same offscreen Canvas 2D context. Browser-only;
 * pure algorithms that need measurement (e.g. render/labels.ts) take a
 * measurement function as a parameter instead of importing this directly,
 * so they stay unit-testable without a canvas.
 */
export function measureTextWidth(value: string, font: Font): number {
	const ctx = getMeasureContext();
	ctx.font = `${font.weight ?? 'normal'} ${font.sizePx}px ${font.family}`;
	return ctx.measureText(value).width;
}
