<script lang="ts">
	import { loadBasemap } from '$lib/basemap/loadBasemap';
	import { SUPPORTED_LANGUAGES, type LanguageCode } from '$lib/basemap/languages';
	import { CITY_SIZE_MAX, populationLabel } from '$lib/basemap/placeSize';
	import { loadWorldAdmin0 } from '$lib/basemap/worldAdmin0';
	import { loadWorldLand } from '$lib/basemap/worldLand';
	import { canvasToPngBlob, downloadBlob, svgBlob } from '$lib/export/download';
	import { buildSceneInput, computeFraming } from '$lib/render/buildSceneInput';
	import { CanvasRenderer } from '$lib/render/canvas';
	import type { DetailBias } from '$lib/render/detail';
	import { MAP_STYLES, type MapStyleId } from '$lib/render/palettes';
	import { composeScene, type OverlayPosition } from '$lib/render/scene';
	import { SvgRenderer } from '$lib/render/svg';
	import { basemapStatus } from '$lib/state/basemapStatus.svelte';
	import { exportSettings } from '$lib/state/settings.svelte';
	import { trackList } from '$lib/state/tracks.svelte';

	let exportError = $state<string | null>(null);
	let exporting = $state(false);

	/**
	 * Resolves after the browser has painted. Rendering an export runs
	 * synchronously on the main thread and takes seconds at large output
	 * sizes, and awaiting a cached basemap only yields a microtask — not a
	 * paint — so without this the button never visibly enters its "Exporting…"
	 * state before the freeze starts. rAF callbacks run before paint, hence
	 * two frames rather than one.
	 */
	function painted(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	/**
	 * document.fonts.ready only resolves loads already in flight — it won't
	 * trigger one on its own. Nothing on the page necessarily renders Roboto
	 * text yet when export starts, so request every weight/style explicitly;
	 * this guarantees composeScene's canvas-based text measurement (shared by
	 * both the PNG and SVG renderers) sees Roboto's real metrics, not a
	 * fallback font's. The italic variants back the title's markdown *italic*
	 * runs (see richTextLayout.ts). Resolves instantly on repeat exports once
	 * the browser has cached the fonts.
	 */
	async function fontsReady(): Promise<void> {
		await Promise.all([
			document.fonts.load('400 16px Roboto'),
			document.fonts.load('700 16px Roboto'),
			document.fonts.load('italic 400 16px Roboto'),
			document.fonts.load('italic 700 16px Roboto')
		]);
	}

	// Export always performs its own basemap load at export resolution,
	// independent of the preview's — the two render at different zooms (the
	// point of "export size is independent of viewport size"), so they must
	// not share loaded tile data even though basemapStatus.status is used
	// below purely as a preflight signal for whether the buttons are usable.
	async function currentScene() {
		const framing = computeFraming({
			width: exportSettings.outputWidth,
			height: exportSettings.outputHeight,
			visibleTracks: trackList.visibleTracks,
			minCoverageKm: exportSettings.minCoverageKm
		});
		if (!framing) return null;

		const [basemap, worldLand, worldAdmin0] = await Promise.all([
			loadBasemap(exportSettings.basemapSource, framing.visibleBbox, framing.zoom, fetch),
			exportSettings.showMinimap ? loadWorldLand(fetch) : Promise.resolve(null),
			exportSettings.showMinimap ? loadWorldAdmin0(fetch) : Promise.resolve(null)
		]);

		return buildSceneInput({
			framing,
			visibleTracks: trackList.visibleTracks,
			basemap,
			mapStyle: exportSettings.mapStyle,
			detailBias: exportSettings.detailBias,
			showAdmin1: exportSettings.showAdmin1,
			showCredit: exportSettings.showCredit,
			showScaleBar: exportSettings.showScaleBar,
			showStats: exportSettings.showStats,
			title: exportSettings.title,
			titlePosition: exportSettings.titlePosition,
			cityLabelLanguage: exportSettings.cityLabelLanguage,
			citySize: exportSettings.citySize,
			showMinimap: exportSettings.showMinimap,
			minimapPosition: exportSettings.minimapPosition,
			minimapCoverageKm: exportSettings.minimapCoverageKm,
			worldLand,
			worldAdmin0
		});
	}

	async function exportPng() {
		exportError = null;
		exporting = true;
		try {
			await painted();
			const scene = await currentScene();
			if (!scene) return;
			await fontsReady();
			const canvas = document.createElement('canvas');
			canvas.width = scene.outputWidth;
			canvas.height = scene.outputHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			composeScene(new CanvasRenderer(ctx, scene.projection), scene);
			downloadBlob(await canvasToPngBlob(canvas), 'track-map.png');
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Failed to export PNG';
		} finally {
			exporting = false;
		}
	}

	async function exportSvg() {
		exportError = null;
		exporting = true;
		try {
			await painted();
			const scene = await currentScene();
			if (!scene) return;
			await fontsReady();
			const renderer = new SvgRenderer(scene.outputWidth, scene.outputHeight, scene.projection);
			composeScene(renderer, scene);
			downloadBlob(svgBlob(renderer.serialize()), 'track-map.svg');
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Failed to export SVG';
		} finally {
			exporting = false;
		}
	}

	function clampDimension(value: number): number {
		if (!Number.isFinite(value)) return 1;
		return Math.min(Math.max(1, Math.round(value)), exportSettings.maxDimensionPx);
	}

	const canExport = $derived(
		trackList.visibleTracks.length > 0 && basemapStatus.status === 'ready' && !exporting
	);
</script>

<div class="export-panel">
	<div class="field">
		<span class="field-label">Basemap</span>
		<div class="segmented" role="group" aria-label="Basemap">
			<button
				class:active={exportSettings.basemapSource === 'osm'}
				onclick={() => (exportSettings.basemapSource = 'osm')}
			>
				OpenStreetMap
			</button>
			<button
				class:active={exportSettings.basemapSource === 'natural-earth'}
				onclick={() => (exportSettings.basemapSource = 'natural-earth')}
			>
				Natural Earth
			</button>
		</div>
	</div>

	<label>
		Map style
		<select
			value={exportSettings.mapStyle}
			onchange={(e) => (exportSettings.mapStyle = (e.target as HTMLSelectElement).value as MapStyleId)}
		>
			{#each MAP_STYLES as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
	</label>

	<div class="row">
		<label>
			Width (px)
			<input
				type="number"
				min="1"
				max={exportSettings.maxDimensionPx}
				value={exportSettings.outputWidth}
				onchange={(e) => (exportSettings.outputWidth = clampDimension(Number((e.target as HTMLInputElement).value)))}
			/>
		</label>
		<label>
			Height (px)
			<input
				type="number"
				min="1"
				max={exportSettings.maxDimensionPx}
				value={exportSettings.outputHeight}
				onchange={(e) => (exportSettings.outputHeight = clampDimension(Number((e.target as HTMLInputElement).value)))}
			/>
		</label>
	</div>

	<label>
		Minimum coverage (km)
		<input
			type="number"
			min="1"
			value={exportSettings.minCoverageKm}
			onchange={(e) => (exportSettings.minCoverageKm = Math.max(1, Number((e.target as HTMLInputElement).value)))}
		/>
	</label>

	<div class="field">
		<label for="title-field">Title</label>
		<textarea
			id="title-field"
			rows="3"
			value={exportSettings.title}
			oninput={(e) => (exportSettings.title = (e.target as HTMLTextAreaElement).value)}
		></textarea>
		<span class="hint">Markdown: **bold**, *italic*, ~~strike~~, `code`, # heading, - list</span>
	</div>

	<label>
		Title position
		<select
			value={exportSettings.titlePosition}
			onchange={(e) => (exportSettings.titlePosition = (e.target as HTMLSelectElement).value as OverlayPosition)}
		>
			<option value="top-left">Top left</option>
			<option value="top-center">Top center</option>
			<option value="top-right">Top right</option>
			<option value="bottom-left">Bottom left</option>
			<option value="bottom-center">Bottom center</option>
			<option value="bottom-right">Bottom right</option>
		</select>
	</label>

	<label class="checkbox">
		<input
			type="checkbox"
			checked={exportSettings.showMinimap}
			onchange={(e) => (exportSettings.showMinimap = (e.target as HTMLInputElement).checked)}
		/>
		Minimap
	</label>

	{#if exportSettings.showMinimap}
		<label>
			Minimap position
			<select
				value={exportSettings.minimapPosition}
				onchange={(e) => (exportSettings.minimapPosition = (e.target as HTMLSelectElement).value as OverlayPosition)}
			>
				<option value="top-left">Top left</option>
				<option value="top-center">Top center</option>
				<option value="top-right">Top right</option>
				<option value="bottom-left">Bottom left</option>
				<option value="bottom-center">Bottom center</option>
				<option value="bottom-right">Bottom right</option>
			</select>
		</label>

		<label class="city-size">
			Minimap coverage
			<div class="slider-row">
				<input
					type="range"
					min="1000"
					max="20000"
					step="500"
					value={exportSettings.minimapCoverageKm}
					aria-valuetext={`${exportSettings.minimapCoverageKm} km`}
					oninput={(e) => (exportSettings.minimapCoverageKm = Number((e.target as HTMLInputElement).value))}
				/>
				<output class="readout">{exportSettings.minimapCoverageKm} km</output>
			</div>
		</label>
	{/if}

	<label>
		Detail
		<select
			value={exportSettings.detailBias}
			onchange={(e) => (exportSettings.detailBias = (e.target as HTMLSelectElement).value as DetailBias)}
		>
			<option value="minimal">Minimal</option>
			<option value="balanced">Balanced</option>
			<option value="rich">Rich</option>
		</select>
	</label>

	<label class="city-size">
		City size
		<div class="slider-row">
			<input
				type="range"
				min="0"
				max={CITY_SIZE_MAX}
				step="1"
				value={exportSettings.citySize}
				aria-valuetext={populationLabel(exportSettings.citySize)}
				oninput={(e) => (exportSettings.citySize = Number((e.target as HTMLInputElement).value))}
			/>
			<output class="readout">{populationLabel(exportSettings.citySize)}</output>
		</div>
		{#if exportSettings.basemapSource === 'natural-earth'}
			<span class="hint">Natural Earth has ~7,200 places worldwide, mostly cities — switch to OpenStreetMap for towns and villages.</span>
		{:else}
			<span class="hint">Approximate — OpenStreetMap tiles carry no population, so size comes from each place's city/town/village/hamlet class.</span>
		{/if}
	</label>

	<label>
		City label language
		<select
			value={exportSettings.cityLabelLanguage}
			onchange={(e) =>
				(exportSettings.cityLabelLanguage = (e.target as HTMLSelectElement).value as LanguageCode)}
		>
			{#each SUPPORTED_LANGUAGES as language (language.code)}
				<option value={language.code}>{language.label}</option>
			{/each}
		</select>
	</label>

	<label class="checkbox">
		<input
			type="checkbox"
			checked={exportSettings.showStats}
			onchange={(e) => (exportSettings.showStats = (e.target as HTMLInputElement).checked)}
		/>
		Show stats
	</label>
	<label class="checkbox">
		<input
			type="checkbox"
			checked={exportSettings.showAdmin1}
			onchange={(e) => (exportSettings.showAdmin1 = (e.target as HTMLInputElement).checked)}
		/>
		State / province borders
	</label>
	<label class="checkbox">
		<input
			type="checkbox"
			checked={exportSettings.showScaleBar}
			onchange={(e) => (exportSettings.showScaleBar = (e.target as HTMLInputElement).checked)}
		/>
		Scale bar
	</label>
	<label class="checkbox">
		<input
			type="checkbox"
			checked={exportSettings.showCredit}
			onchange={(e) => (exportSettings.showCredit = (e.target as HTMLInputElement).checked)}
		/>
		Show data credit
	</label>

	{#if exportError}
		<p class="error">{exportError}</p>
	{/if}

	<div class="actions" aria-busy={exporting}>
		<button onclick={exportPng} disabled={!canExport}>
			{exporting ? 'Exporting…' : 'Export PNG'}
		</button>
		<button onclick={exportSvg} disabled={!canExport}>
			{exporting ? 'Exporting…' : 'Export SVG'}
		</button>
	</div>
</div>

<style>
	.export-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.row {
		display: flex;
		gap: 0.6rem;
	}
	.row label {
		flex: 1;
	}
	label,
	.field {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		color: #555;
		gap: 0.2rem;
	}
	.field-label {
		font-size: 0.85rem;
		color: #555;
	}
	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	.slider-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.slider-row input[type='range'] {
		flex: 1;
		min-width: 0;
	}
	.readout {
		width: 4.5rem;
		flex-shrink: 0;
		font-size: 0.85rem;
		text-align: right;
		white-space: nowrap;
	}
	.hint {
		font-size: 0.8rem;
		color: #888;
	}
	input[type='number'],
	select,
	textarea {
		padding: 0.3rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	textarea {
		font: inherit;
		resize: vertical;
	}
	.segmented {
		display: flex;
		border: 1px solid #ccc;
		border-radius: 6px;
		overflow: hidden;
	}
	.segmented button {
		flex: 1;
		padding: 0.4rem 0.5rem;
		border: none;
		background: white;
		color: #555;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.segmented button.active {
		background: #5b8def;
		color: white;
	}
	.error {
		color: #a02020;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	button {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 6px;
		background: #5b8def;
		color: white;
		cursor: pointer;
	}
	button:disabled {
		background: #ccc;
		cursor: not-allowed;
	}
</style>
