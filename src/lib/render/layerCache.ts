import { CanvasRenderer } from './canvas';
import { composeScenePhase, type SceneInput } from './scene';

export interface CachedLayers {
	basemapKey: string;
	overlayKey: string;
	/** The 'basemap' phase, composited first. */
	below: HTMLCanvasElement;
	/** The 'overlay' phase, composited last (city labels, scale bar, credit). */
	above: HTMLCanvasElement;
}

// Cheap stable ids for objects that can't be stringified into the key
// (projection is a closure, basemap is a large feature collection) but are
// held as stable references by the caller (PreviewCanvas's `loaded` state)
// across ticks that don't change them.
let nextId = 0;
const identityTokens = new WeakMap<object, number>();

function identityToken(value: object): number {
	let token = identityTokens.get(value);
	if (token === undefined) {
		token = ++nextId;
		identityTokens.set(value, token);
	}
	return token;
}

/**
 * Identifies everything the 'basemap' phase reads. Deliberately enumerates
 * fields rather than a blanket `JSON.stringify(input)` — that would pick up
 * per-track style (colour/width/opacity) and miss on every slider tick,
 * defeating the cache entirely.
 *
 * `overlay.detailBias` is included only when `basemap.hasDetailLevels` is
 * true — OSM's decoded tiles carry no `min_zoom` (see `BasemapLayers`' doc
 * comment), so `visibleAt` treats every OSM feature as always-visible and a
 * `detailBias` change can't affect what's drawn there at all. Keying on it
 * anyway would still bust this cache and pay a full recompose for a no-op.
 */
export function basemapLayerKey(input: SceneInput): string {
	const { outputWidth, outputHeight, marginPx, projection, basemap, overlay } = input;
	return [
		outputWidth,
		outputHeight,
		marginPx,
		identityToken(projection),
		identityToken(basemap),
		overlay.showAdmin1,
		basemap.hasDetailLevels ? overlay.detailBias : null
	].join('|');
}

/**
 * Identifies everything the 'overlay' phase reads (city labels, scale bar,
 * credit). Kept separate from basemapLayerKey so a city-size or
 * label-language change — both overlay-only — re-renders just this cheap
 * phase instead of the polygon-heavy basemap phase alongside it. Title (text
 * and position) is deliberately absent: it belongs to the 'text' phase now,
 * which is never cached (see scene.ts's ScenePhase doc comment and
 * PreviewCanvas.svelte) — including it here would still bust this bitmap on
 * every keystroke even though 'overlay' itself doesn't draw it.
 */
export function overlayLayerKey(input: SceneInput): string {
	const { outputWidth, outputHeight, marginPx, projection, basemap, overlay } = input;
	return [
		outputWidth,
		outputHeight,
		marginPx,
		identityToken(projection),
		identityToken(basemap),
		overlay.cityLabelLanguage,
		overlay.citySize,
		overlay.showCredit,
		overlay.showScaleBar,
		overlay.statsText
	].join('|');
}

/**
 * Reuses `previous` when its dimensions still match, so a drag doesn't churn
 * multi-megabyte buffers. Reports whether the bitmap was cleared — assigning
 * to canvas.width/height resets it, so a resized canvas must be re-rendered
 * even when its layer key is unchanged.
 */
function sizedCanvas(
	previous: HTMLCanvasElement | undefined,
	width: number,
	height: number
): { canvas: HTMLCanvasElement; cleared: boolean } {
	const canvas = previous ?? document.createElement('canvas');
	// Assigning to .width/.height clears the canvas even when the value is
	// unchanged (per spec, any assignment re-runs the "set bitmap
	// dimensions" algorithm) — so these must stay conditional, not just the
	// `cleared` bookkeeping.
	const cleared = canvas.width !== width || canvas.height !== height;
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	return { canvas, cleared };
}

/**
 * Renders the 'basemap' and 'overlay' phases into two offscreen bitmaps,
 * reusing `previous`'s canvases when their dimensions still match so a drag
 * doesn't churn multi-megabyte buffers on every tick, and re-rendering only
 * whichever phase's key actually changed — a city-size or label-language
 * edit touches only 'overlay', not the polygon-heavy 'basemap' phase. The
 * caller composites these with a live 'tracks' phase drawn in between — see
 * PreviewCanvas.svelte.
 */
export function renderCachedLayers(input: SceneInput, previous: CachedLayers | null): CachedLayers {
	const basemapKey = basemapLayerKey(input);
	const overlayKey = overlayLayerKey(input);

	const { canvas: below, cleared: belowCleared } = sizedCanvas(previous?.below, input.outputWidth, input.outputHeight);
	const { canvas: above, cleared: aboveCleared } = sizedCanvas(previous?.above, input.outputWidth, input.outputHeight);

	if (!previous || belowCleared || previous.basemapKey !== basemapKey) {
		const belowCtx = below.getContext('2d');
		if (!belowCtx) throw new Error('2D canvas context unavailable');
		belowCtx.clearRect(0, 0, input.outputWidth, input.outputHeight);
		composeScenePhase(new CanvasRenderer(belowCtx, input.projection), input, 'basemap');
	}

	if (!previous || aboveCleared || previous.overlayKey !== overlayKey) {
		const aboveCtx = above.getContext('2d');
		if (!aboveCtx) throw new Error('2D canvas context unavailable');
		aboveCtx.clearRect(0, 0, input.outputWidth, input.outputHeight);
		composeScenePhase(new CanvasRenderer(aboveCtx, input.projection), input, 'overlay');
	}

	return { basemapKey, overlayKey, below, above };
}
