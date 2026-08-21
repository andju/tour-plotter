<script lang="ts">
	import { onMount } from 'svelte';
	import { loadBasemap } from '$lib/basemap/loadBasemap';
	import type { BasemapLayers } from '$lib/basemap/types';
	import { loadWorldAdmin0 } from '$lib/basemap/worldAdmin0';
	import { loadWorldLand } from '$lib/basemap/worldLand';
	import { buildSceneInput, computeFraming, type BuildSceneOptions, type Framing } from '$lib/render/buildSceneInput';
	import { CanvasRenderer } from '$lib/render/canvas';
	import { basemapLayerKey, minimapLayerKey, overlayLayerKey, renderCachedLayers, type CachedLayers } from '$lib/render/layerCache';
	import { composeScenePhase, type SceneInput } from '$lib/render/scene';
	import { basemapStatus } from '$lib/state/basemapStatus.svelte';
	import { exportSettings } from '$lib/state/settings.svelte';
	import { trackList } from '$lib/state/tracks.svelte';

	let canvasEl: HTMLCanvasElement;
	let textCanvasEl: HTMLCanvasElement;
	let containerEl: HTMLDivElement;
	let containerWidth = $state(600);

	// Debounced: a live drag-resize fires the observer many times per
	// second, and each tick would otherwise produce a new `backing` -> new
	// `framing` -> a `loadBasemap` call and a scheduled recompose (see
	// `framing` below) even though only the value the user lands on
	// matters. The rAF-cancel in the map effect further down coalesces
	// the *draw*, but not this framing/fetch churn, hence the separate debounce.
	const RESIZE_DEBOUNCE_MS = 120;

	onMount(() => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const ro = new ResizeObserver((entries) => {
			const width = entries[0].contentRect.width;
			clearTimeout(timeout);
			timeout = setTimeout(() => (containerWidth = width), RESIZE_DEBOUNCE_MS);
		});
		ro.observe(containerEl);
		return () => {
			clearTimeout(timeout);
			ro.disconnect();
		};
	});

	interface Backing {
		cssWidth: number;
		cssHeight: number;
		pixelWidth: number;
		pixelHeight: number;
	}

	// Browsers refuse — or silently hand back a blank buffer for — a canvas
	// whose backing store runs to tens of thousands of pixels on a side.
	// An extreme output aspect ratio (e.g. the width settings's floor of 1px
	// against the default 1200px height) would otherwise imply exactly that,
	// even though both settings individually stay within their own bounds.
	// Capping the longer backing-store side keeps the preview always
	// paintable, trading resolution for that combination — it never touches
	// the actual export, which sizes its own canvas straight from
	// exportSettings.outputWidth/outputHeight.
	const MAX_PREVIEW_BACKING_PX = 4096;

	const backing = $derived.by((): Backing => {
		const aspect = exportSettings.outputWidth / exportSettings.outputHeight;
		const dpr = window.devicePixelRatio || 1;
		const cssWidth = containerWidth;
		const cssHeight = cssWidth / aspect;

		let pixelWidth = Math.round(cssWidth * dpr);
		let pixelHeight = Math.round(cssHeight * dpr);
		const longestSide = Math.max(pixelWidth, pixelHeight);
		if (longestSide > MAX_PREVIEW_BACKING_PX) {
			const scale = MAX_PREVIEW_BACKING_PX / longestSide;
			pixelWidth = Math.max(1, Math.round(pixelWidth * scale));
			pixelHeight = Math.max(1, Math.round(pixelHeight * scale));
		}

		return { cssWidth, cssHeight, pixelWidth, pixelHeight };
	});

	// Framing is the dividing line between "needs new basemap data" and
	// "just needs redrawing". It depends only on canvas size, track
	// geometry and the coverage floor — so it, and therefore the fetch
	// effect below, stays untouched by every cosmetic setting (track
	// colour, stats, scale bar, credit, title text/position, detail bias).
	const framing = $derived(
		backing.pixelWidth > 0
			? computeFraming({
					width: backing.pixelWidth,
					height: backing.pixelHeight,
					visibleTracks: trackList.visibleTracks,
					minCoverageKm: exportSettings.minCoverageKm
				})
			: null
	);

	// The basemap is published together with the framing it was fetched for,
	// so the draw effects can never pair fresh tiles with a stale projection
	// (or vice versa) while a fetch is in flight.
	//
	// `$state.raw`, emphatically not `$state`: a deep `$state` recursively
	// proxies whatever is assigned to it, and `basemap` is a feature
	// collection holding hundreds of thousands of coordinate pairs. Every one
	// of those nested arrays would get its own Proxy and its own signal the
	// first time something read through it — and `visibleFeatures` ->
	// `featureBbox` (cull.ts) reads *every* coordinate on every compose. That
	// cost ~500MB of heap and ~1.5s per reassignment on a 30-tile OSM cover,
	// repaid in full on each one, since a fresh `loaded` object means a fresh
	// proxy graph even when the tiles underneath are cache hits. Nothing here
	// mutates `loaded` in place — it is only ever swapped wholesale — so the
	// deep reactivity bought nothing to begin with.
	let loaded = $state.raw<{ backing: Backing; framing: Framing; basemap: BasemapLayers } | null>(null);

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

	// Coarse world land backing the minimap inset — fetched lazily, only once
	// the minimap is switched on, and kept separate from the basemap-fetch
	// effect above so enabling it never touches basemapStatus or re-requests
	// tiles. A failed fetch leaves worldLand null (drawMinimap just omits the
	// panel — see scene.ts) and retries next time this effect's dependencies
	// change, e.g. the checkbox being toggled off and on again.
	// `$state.raw` for the same reason as `loaded` above — these are whole
	// Natural Earth feature collections, assigned once and never mutated.
	let worldLand = $state.raw<GeoJSON.FeatureCollection | null>(null);
	let worldAdmin0 = $state.raw<GeoJSON.FeatureCollection | null>(null);

	$effect(() => {
		if (!exportSettings.showMinimap || worldLand) return;
		loadWorldLand(fetch)
			.then((fc) => (worldLand = fc))
			.catch((err) => console.error('Failed to load minimap land data', err));
	});

	$effect(() => {
		if (!exportSettings.showMinimap || worldAdmin0) return;
		loadWorldAdmin0(fetch)
			.then((fc) => (worldAdmin0 = fc))
			.catch((err) => console.error('Failed to load minimap admin0 data', err));
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

	// The 'basemap', 'overlay' and 'minimap' phases as bitmaps, each keyed on
	// everything that affects it (see layerCache.ts). Per-track style never
	// appears in any of those keys, so a slider drag hits this cache on every
	// tick and only the 'tracks' phase — a few ms — has to be redrawn live.
	// Title text/position don't appear in any of them either — the map effect
	// below always builds its scene with a blank title, so a keystroke in the
	// title field never busts this cache.
	let cache: CachedLayers | null = null;

	type Loaded = NonNullable<typeof loaded>;

	// Shared by both draw effects below; deliberately a plain function called
	// inside each effect's own body rather than a $derived — a $derived
	// object would read title itself and re-couple the two effects'
	// reactivity, which is the exact thing this split exists to avoid.
	function sceneOptions(current: Loaded, title: string): BuildSceneOptions {
		return {
			framing: current.framing,
			visibleTracks: trackList.visibleTracks,
			basemap: current.basemap,
			mapStyle: exportSettings.mapStyle,
			detailBias: exportSettings.detailBias,
			showAdmin1: exportSettings.showAdmin1,
			showCredit: exportSettings.showCredit,
			showScaleBar: exportSettings.showScaleBar,
			showStats: exportSettings.showStats,
			title,
			titlePosition: exportSettings.titlePosition,
			cityLabelLanguage: exportSettings.cityLabelLanguage,
			citySize: exportSettings.citySize,
			showMinimap: exportSettings.showMinimap,
			minimapPosition: exportSettings.minimapPosition,
			minimapCoverageKm: exportSettings.minimapCoverageKm,
			worldLand,
			worldAdmin0
		};
	}

	// The map: cached 'basemap' + live 'tracks' + cached 'overlay' + cached
	// 'minimap'. Never reads exportSettings.title — its scene is always built
	// with a blank title, so a keystroke in that field cannot invalidate
	// anything here.
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
		// would be invisible to reactivity. This used to need a per-track
		// clone to force reactive reads of style fields (which are otherwise
		// only dereferenced deep inside composeScenePhase), but `trackList.tracks`
		// is now `$state.raw` (see tracks.svelte.ts): every style edit assigns a
		// whole new array, so reading `trackList.visibleTracks` here is itself
		// the dependency and no clone is needed. Title is deliberately blank —
		// see this effect's doc comment above.
		const scene = buildSceneInput({ ...sceneOptions(current, ''), visibleTracks: trackList.visibleTracks });

		if (
			cache &&
			cache.basemapKey === basemapLayerKey(scene) &&
			cache.overlayKey === overlayLayerKey(scene) &&
			cache.minimapKey === minimapLayerKey(scene)
		) {
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
		ctx.drawImage(layers.inset, 0, 0);
	}

	// The title pill: the 'text' phase only, redrawn live on every keystroke
	// (and on every position change). Unlike the map effect above, this one
	// *does* read exportSettings.title directly — that's fine here, because
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

		const scene = buildSceneInput(sceneOptions(current, exportSettings.title));

		const width = scene.outputWidth;
		const height = scene.outputHeight;
		if (textCanvasEl.width !== width) textCanvasEl.width = width;
		if (textCanvasEl.height !== height) textCanvasEl.height = height;
		textCanvasEl.style.width = `${current.backing.cssWidth}px`;
		textCanvasEl.style.height = `${current.backing.cssWidth * (height / width)}px`;

		const ctx = textCanvasEl.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);
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
