<script lang="ts">
	import { onMount } from 'svelte';
	import { loadBasemap } from '$lib/basemap/loadBasemap';
	import type { BasemapLayers } from '$lib/basemap/types';
	import { buildSceneInput, computeFraming, type BuildSceneOptions, type Framing } from '$lib/render/buildSceneInput';
	import { CanvasRenderer } from '$lib/render/canvas';
	import { basemapLayerKey, overlayLayerKey, renderCachedLayers, type CachedLayers } from '$lib/render/layerCache';
	import { composeScenePhase, type SceneInput } from '$lib/render/scene';
	import { basemapStatus } from '$lib/state/basemapStatus.svelte';
	import { exportSettings } from '$lib/state/settings.svelte';
	import { trackList } from '$lib/state/tracks.svelte';

	let canvasEl: HTMLCanvasElement;
	let textCanvasEl: HTMLCanvasElement;
	let containerEl: HTMLDivElement;
	let containerWidth = $state(600);

	onMount(() => {
		const ro = new ResizeObserver((entries) => {
			containerWidth = entries[0].contentRect.width;
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	interface Backing {
		cssWidth: number;
		cssHeight: number;
		pixelWidth: number;
		pixelHeight: number;
	}

	const backing = $derived.by((): Backing => {
		const aspect = exportSettings.outputWidth / exportSettings.outputHeight;
		const dpr = window.devicePixelRatio || 1;
		const cssWidth = containerWidth;
		const cssHeight = cssWidth / aspect;
		return {
			cssWidth,
			cssHeight,
			pixelWidth: Math.round(cssWidth * dpr),
			pixelHeight: Math.round(cssHeight * dpr)
		};
	});

	// Memoised, not read raw off exportSettings inside an effect: a $derived
	// only notifies dependents when its *value* changes, so `framing` below
	// sees one invalidation per empty<->non-empty transition instead of one
	// per keystroke. Reading `exportSettings.title.trim()` directly inside an
	// effect would defeat that — Svelte tracks the property read, not the
	// derived outcome.
	const hasTitle = $derived(exportSettings.title.trim().length > 0);
	const hasDescription = $derived(exportSettings.description.trim().length > 0);

	// Framing is the dividing line between "needs new basemap data" and
	// "just needs redrawing". It depends on canvas size, track geometry, the
	// coverage floor, and title/description *presence* (which reserves top
	// space in the map's own fit — see computeFraming's doc comment and
	// buildProjection's `topInsetPx`) — so it, and therefore the fetch effect
	// below, stays untouched when a purely cosmetic setting (track colour,
	// stats, scale bar, credit, title/description *text*, detail bias)
	// changes, but does react to a title/description empty<->non-empty
	// transition.
	const framing = $derived(
		backing.pixelWidth > 0
			? computeFraming({
					width: backing.pixelWidth,
					height: backing.pixelHeight,
					visibleTracks: trackList.visibleTracks,
					minCoverageKm: exportSettings.minCoverageKm,
					hasTitle,
					hasDescription
				})
			: null
	);

	// The basemap is published together with the framing it was fetched for,
	// so the draw effects can never pair fresh tiles with a stale projection
	// (or vice versa) while a fetch is in flight.
	let loaded = $state<{ backing: Backing; framing: Framing; basemap: BasemapLayers } | null>(null);

	// Guards against a fast resize superseding an in-flight basemap fetch
	// before it resolves, which would otherwise paint stale tiles over the
	// current, correct framing.
	let requestSeq = 0;

	$effect(() => {
		const currentBacking = backing;
		const currentFraming = framing;
		const source = exportSettings.basemapSource;

		const seq = ++requestSeq;

		if (!currentFraming) {
			loaded = null;
			basemapStatus.status = 'idle';
			basemapStatus.error = null;
			return;
		}

		basemapStatus.status = 'loading';
		basemapStatus.error = null;

		loadBasemap(source, currentFraming.visibleBbox, currentFraming.zoom, fetch)
			.then((basemap) => {
				if (seq !== requestSeq) return;
				loaded = { backing: currentBacking, framing: currentFraming, basemap };
				basemapStatus.status = 'ready';
			})
			.catch((err) => {
				if (seq !== requestSeq) return;
				basemapStatus.status = 'error';
				basemapStatus.error = err instanceof Error ? err.message : 'Failed to load basemap';
			});
	});

	// True from the moment a redraw is scheduled until the canvas has been
	// repainted. Drives the busy badge — composing the 'basemap'/'overlay'
	// phases from scratch costs ~250ms at preview size, which is far too long
	// to leave the user wondering whether their click registered. A cache hit
	// (a track colour/width/opacity edit) only recomposites already-cached
	// bitmaps, so it never sets this. The 'text' phase never sets it at all:
	// see the text effect further down.
	let redrawing = $state(false);
	let frame = 0;

	// The 'basemap' and 'overlay' phases as bitmaps, keyed on everything that
	// affects them (layerCacheKey). Per-track style never appears in that key,
	// so a slider drag hits this cache on every tick and only the 'tracks'
	// phase — a few ms — has to be redrawn live. Title/description *text*
	// don't appear in it either (see layerCache.ts's overlayLayerKey) — the
	// map effect below always builds its scene with blank title/description,
	// so a keystroke in either field never busts this cache. Their *presence*
	// does invalidate it, but only indirectly: a presence transition produces
	// a new `Framing` (and therefore a new `projection` identity), which
	// `basemapLayerKey`/`overlayLayerKey` already key on.
	let cache: CachedLayers | null = null;

	type Loaded = NonNullable<typeof loaded>;

	// Shared by both draw effects below; deliberately a plain function called
	// inside each effect's own body rather than a $derived — a $derived
	// object would read title/description itself and re-couple the two
	// effects' reactivity, which is the exact thing this split exists to
	// avoid.
	function sceneOptions(current: Loaded, title: string, description: string): BuildSceneOptions {
		return {
			framing: current.framing,
			visibleTracks: trackList.visibleTracks,
			basemap: current.basemap,
			detailBias: exportSettings.detailBias,
			showAdmin1: exportSettings.showAdmin1,
			showCredit: exportSettings.showCredit,
			showScaleBar: exportSettings.showScaleBar,
			showStats: exportSettings.showStats,
			title,
			description,
			cityLabelLanguage: exportSettings.cityLabelLanguage,
			citySize: exportSettings.citySize
		};
	}

	// The map: cached 'basemap' + live 'tracks' + cached 'overlay'. Never
	// reads exportSettings.title or .description — its scene is always built
	// with blank text, so a keystroke in either field cannot invalidate
	// anything here. Its `framing` (and therefore its projection, which
	// already reserves top space for the band once title/description is
	// non-empty — see computeFraming) comes from `current.framing`, so it
	// naturally lines up with the text canvas below without any y-offset
	// compositing trick.
	$effect(() => {
		if (!canvasEl) return;
		const current = loaded;

		// With nothing loaded the canvas still holds the export aspect ratio,
		// so the empty-state placeholder matches what the export will be.
		// `backing` is read only on this path: once something is loaded the
		// draw effect no longer depends on it, so a resize doesn't blank the
		// canvas before the new tiles arrive.
		if (!current) {
			const { cssWidth, cssHeight, pixelWidth, pixelHeight } = backing;
			canvasEl.width = pixelWidth;
			canvasEl.height = pixelHeight;
			canvasEl.style.width = `${cssWidth}px`;
			canvasEl.style.height = `${cssHeight}px`;
			redrawing = false;
			cache = null;
			return;
		}

		// Everything the scene depends on is read here, synchronously, inside
		// the effect's tracking window — the draw itself may happen two frames
		// later, long after that window has closed, so anything read there
		// would be invisible to reactivity. Per-track style fields are only
		// otherwise dereferenced deep inside composeScenePhase, so clone `style`
		// to force those reads in here too. buildSceneInput is ~0.1ms, so
		// running it up front costs nothing. Title/description are
		// deliberately blank — see this effect's doc comment above.
		const visibleTracks = trackList.visibleTracks.map((t) => ({ ...t, style: { ...t.style } }));
		const scene = buildSceneInput({ ...sceneOptions(current, '', ''), visibleTracks });

		if (cache && cache.basemapKey === basemapLayerKey(scene) && cache.overlayKey === overlayLayerKey(scene)) {
			// A pure track-style tick: the cached bitmaps are still valid, so
			// composite inline rather than deferring — it's cheap enough not to
			// need the two-frame dance below, and deferring it would show one
			// stale frame per tick during a drag.
			compositeFromCache(current, scene, cache);
			redrawing = false;
			return;
		}

		redrawing = true;

		// Two frames, not one. A Svelte effect runs before the browser paints,
		// so composing inline means the ~250ms of drawing lands in the same
		// frame as the click that caused it — the checkbox the user just
		// toggled doesn't even visibly flip until the map is done, which reads
		// as a freeze. The first frame paints the control and the busy badge;
		// the second does the work. rAF callbacks also run before paint, so
		// one frame would not be enough.
		frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				cache = renderCachedLayers(scene, cache);
				compositeFromCache(current, scene, cache);
				redrawing = false;
			});
		});

		// Cancels a redraw that a newer change has superseded, so dragging a
		// colour picker composes only the value the user lands on instead of
		// queueing a 250ms draw per tick.
		return () => cancelAnimationFrame(frame);
	});

	function compositeFromCache(current: Loaded, scene: SceneInput, layers: CachedLayers): void {
		if (!canvasEl) return;

		// Sizing the canvas resets its 2D context, so it has to happen here
		// rather than before the deferral — and doing it here also means the
		// previous frame stays on screen until the new one is ready, instead
		// of the canvas blanking for the duration of the draw. Guarded:
		// assigning to .width/.height always clears the bitmap even when the
		// value is unchanged, so an unconditional assignment here would
		// reallocate on every single composite, including a plain track-style
		// tick.
		const width = scene.outputWidth;
		const height = scene.outputHeight;
		if (canvasEl.width !== width) canvasEl.width = width;
		if (canvasEl.height !== height) canvasEl.height = height;
		canvasEl.style.width = `${current.backing.cssWidth}px`;
		canvasEl.style.height = `${current.backing.cssWidth * (height / width)}px`;

		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(layers.below, 0, 0);
		composeScenePhase(new CanvasRenderer(ctx, scene.projection), scene, 'tracks');
		ctx.drawImage(layers.above, 0, 0);
	}

	// The title/description band: the 'text' phase only, redrawn live on
	// every keystroke. Unlike the map effect above, this one *does* read
	// exportSettings.title/.description directly — that's fine here, because
	// the 'text' phase is a couple of fillRect/fillText calls (~1ms), not the
	// place-projection-and-label-placement work the 'overlay' phase does. No
	// requestAnimationFrame deferral and no `redrawing` flag: there's nothing
	// slow enough here to need either.
	$effect(() => {
		if (!textCanvasEl) return;
		const current = loaded;

		if (!current) {
			const { pixelWidth, pixelHeight } = backing;
			if (textCanvasEl.width !== pixelWidth) textCanvasEl.width = pixelWidth;
			if (textCanvasEl.height !== pixelHeight) textCanvasEl.height = pixelHeight;
			return;
		}

		const scene = buildSceneInput(sceneOptions(current, exportSettings.title, exportSettings.description));

		const width = scene.outputWidth;
		const height = scene.outputHeight;
		if (textCanvasEl.width !== width) textCanvasEl.width = width;
		if (textCanvasEl.height !== height) textCanvasEl.height = height;
		textCanvasEl.style.width = `${current.backing.cssWidth}px`;
		textCanvasEl.style.height = `${current.backing.cssWidth * (height / width)}px`;

		const ctx = textCanvasEl.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		// No band-background fill needed here: the map effect's cached
		// bitmaps share this same scene's projection (band space already
		// reserved by computeFraming/buildProjection), so they've already
		// painted genuine basemap content into the band region. This phase
		// only draws the title/description pills on top of it — see
		// composeScenePhase's 'text' phase doc comment in scene.ts.
		composeScenePhase(new CanvasRenderer(ctx, scene.projection), scene, 'text');
	});

	const busyLabel = $derived.by(() => {
		if (trackList.visibleTracks.length === 0) return null;
		if (basemapStatus.status === 'loading') return 'Loading basemap…';
		return redrawing ? 'Updating preview…' : null;
	});
</script>

<div class="preview-container" bind:this={containerEl} aria-busy={busyLabel !== null}>
	<div class="canvas-stack">
		<canvas class="map-layer" bind:this={canvasEl}></canvas>
		<canvas class="text-layer" bind:this={textCanvasEl}></canvas>
	</div>
	{#if trackList.visibleTracks.length === 0}
		<p class="hint">Load a GPX track to see the preview</p>
	{:else if basemapStatus.status === 'error'}
		<p class="hint error">{basemapStatus.error}</p>
	{/if}
	{#if busyLabel}
		<p class="busy" role="status">
			<span class="spinner" aria-hidden="true"></span>{busyLabel}
		</p>
	{/if}
</div>

<style>
	.preview-container {
		position: relative;
		width: 100%;
	}
	.canvas-stack {
		position: relative;
	}
	canvas {
		display: block;
		border-radius: 8px;
	}
	.map-layer {
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
	}
	.text-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.hint {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #888;
	}
	.hint.error {
		color: #a02020;
	}
	/* A pill, not the centred hint: it sits over a map that's still showing
	   the previous render, so it needs its own background to stay legible. */
	.busy {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
		font-size: 0.8rem;
		color: #555;
	}
	.spinner {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid #ccc;
		border-top-color: #5b8def;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
