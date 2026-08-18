import { describe, expect, it } from 'vitest';
import type { BasemapLayers } from '../basemap/types';
import type { Track } from '../gpx/types';
import { buildSceneInput, computeFraming, type BuildSceneOptions } from './buildSceneInput';
import { DEFAULT_SCENE_STYLE } from './defaultStyle';
import { descriptionBandHeightPx, titleBandHeightPx } from './scene';

function emptyBasemap(): BasemapLayers {
	return {
		baseFill: 'water',
		land: null,
		water: { type: 'FeatureCollection', features: [] },
		waterways: { type: 'FeatureCollection', features: [] },
		urban: { type: 'FeatureCollection', features: [] },
		parks: { type: 'FeatureCollection', features: [] },
		admin0: { type: 'FeatureCollection', features: [] },
		admin1: { type: 'FeatureCollection', features: [] },
		places: { type: 'FeatureCollection', features: [] },
		attribution: '© Natural Earth'
	};
}

const track: Track = {
	id: 't1',
	name: 'Sample',
	segments: [
		[
			{ lon: 13.1, lat: 52.1, ele: null, time: null },
			{ lon: 13.4, lat: 52.4, ele: null, time: null }
		]
	],
	style: { color: '#ff0000', widthPx: 3, opacity: 1, visible: true }
};

function baseOptions(overrides: Partial<BuildSceneOptions> = {}): BuildSceneOptions {
	const framing = computeFraming({
		width: 1000,
		height: 1000,
		visibleTracks: [track],
		minCoverageKm: 25
	})!;

	return {
		framing,
		visibleTracks: [track],
		basemap: emptyBasemap(),
		detailBias: 'balanced',
		showAdmin1: false,
		showCredit: false,
		showScaleBar: false,
		showStats: false,
		title: '',
		description: '',
		cityLabelLanguage: 'en',
		citySize: 0,
		...overrides
	};
}

describe('buildSceneInput — title/description bands', () => {
	it('leaves outputHeight and the projection untouched when neither is set', () => {
		const opts = baseOptions();
		const scene = buildSceneInput(opts);

		expect(scene.outputHeight).toBe(opts.framing.outputHeight);
		expect(scene.projection).toBe(opts.framing.projection);
	});

	it('grows outputHeight by exactly the title band when a title is set', () => {
		const opts = baseOptions({ title: 'Alpine Loop' });
		const scene = buildSceneInput(opts);
		const expectedBandPx = titleBandHeightPx(DEFAULT_SCENE_STYLE) * (opts.framing.outputWidth / 1000);

		expect(scene.outputHeight).toBeCloseTo(opts.framing.outputHeight + expectedBandPx, 5);
		expect(scene.outputWidth).toBe(opts.framing.outputWidth);
	});

	it('grows outputHeight by the title band plus the description band when both are set (description stacks directly below the title)', () => {
		const opts = baseOptions({ title: 'Alpine Loop', description: 'A weekend ride through the Alps.' });
		const scene = buildSceneInput(opts);
		const scaleFactor = opts.framing.outputWidth / 1000;
		const expectedBandPx =
			(titleBandHeightPx(DEFAULT_SCENE_STYLE) + descriptionBandHeightPx(DEFAULT_SCENE_STYLE)) * scaleFactor;

		expect(scene.outputHeight).toBeCloseTo(opts.framing.outputHeight + expectedBandPx, 5);
	});

	it('grows outputHeight by exactly the description band when only a description is set', () => {
		const opts = baseOptions({ description: 'A weekend ride through the Alps.' });
		const scene = buildSceneInput(opts);
		const expectedBandPx = descriptionBandHeightPx(DEFAULT_SCENE_STYLE) * (opts.framing.outputWidth / 1000);

		expect(scene.outputHeight).toBeCloseTo(opts.framing.outputHeight + expectedBandPx, 5);
		expect(scene.projection).not.toBe(opts.framing.projection);
	});

	it('shifts the render projection down by the title band, without mutating the framing projection', () => {
		const opts = baseOptions({ title: 'Alpine Loop' });
		const before = opts.framing.projection.translate();
		const scene = buildSceneInput(opts);
		const after = opts.framing.projection.translate();
		const scale = opts.framing.outputWidth / 1000;
		const expectedBandPx = titleBandHeightPx(DEFAULT_SCENE_STYLE) * scale;

		// The framing's own projection (used for the basemap fetch) must be untouched...
		expect(after).toEqual(before);
		// ...while the scene's render projection is offset by the title band.
		const [tx, ty] = scene.projection.translate();
		expect(tx).toBeCloseTo(before[0], 5);
		expect(ty).toBeCloseTo(before[1] + expectedBandPx, 5);
	});

	it('returns the same projection instance across repeated calls against one framing (layerCache identity)', () => {
		const opts = baseOptions({ title: 'Alpine Loop' });
		const first = buildSceneInput(opts);
		const second = buildSceneInput(opts);

		expect(second.projection).toBe(first.projection);
	});

	it('shifts by the right amount when title-only and title+description scenes share one framing instance', () => {
		const framing = computeFraming({ width: 1000, height: 1000, visibleTracks: [track], minCoverageKm: 25 })!;
		const scale = framing.outputWidth / 1000;

		const titleOnly = buildSceneInput(baseOptions({ framing, title: 'Alpine Loop' }));
		const titleAndDescription = buildSceneInput(
			baseOptions({ framing, title: 'Alpine Loop', description: 'A weekend ride through the Alps.' })
		);
		const titleOnlyAgain = buildSceneInput(baseOptions({ framing, title: 'Alpine Loop' }));

		expect(titleOnly.projection.translate()[1]).toBeCloseTo(
			framing.projection.translate()[1] + titleBandHeightPx(DEFAULT_SCENE_STYLE) * scale,
			5
		);
		expect(titleAndDescription.projection.translate()[1]).toBeCloseTo(
			framing.projection.translate()[1] +
				(titleBandHeightPx(DEFAULT_SCENE_STYLE) + descriptionBandHeightPx(DEFAULT_SCENE_STYLE)) * scale,
			5
		);
		// Landing back on the title-only amount reuses the title-only instance rather than
		// the (still-cached) title+description one for the same Framing.
		expect(titleOnlyAgain.projection).toBe(titleOnly.projection);
		expect(titleOnlyAgain.projection).not.toBe(titleAndDescription.projection);
	});

	it('computeFraming is independent of whether a title/description will be drawn', () => {
		const withTitle = computeFraming({ width: 1000, height: 1000, visibleTracks: [track], minCoverageKm: 25 });
		const withoutTitle = computeFraming({ width: 1000, height: 1000, visibleTracks: [track], minCoverageKm: 25 });

		expect(withTitle!.outputHeight).toBe(withoutTitle!.outputHeight);
		expect(withTitle!.visibleBbox).toEqual(withoutTitle!.visibleBbox);
		expect(withTitle!.zoom).toBe(withoutTitle!.zoom);
	});

	// Regression test: at a preview width like 600, the unrounded band height
	// (28 * 1.5 * 0.6 = 25.2) made outputHeight fractional. Canvas
	// width/height are WebIDL unsigned longs, so a fractional value never
	// reads back equal to what was assigned — layerCache's sizedCanvas saw a
	// spurious size change on every redraw and cleared its cached basemap
	// bitmap without repainting it, leaving the preview blank whenever an
	// overlay-only setting (stats, scale bar, credit, city size, ...) changed
	// while a title/description was set. See layerCache.ts's sizedCanvas.
	it('keeps outputHeight an integer at a non-reference width with a title and description', () => {
		const framing = computeFraming({ width: 600, height: 800, visibleTracks: [track], minCoverageKm: 25 })!;
		const scene = buildSceneInput(
			baseOptions({ framing, title: 'Alpine Loop', description: 'A weekend ride through the Alps.' })
		);

		expect(Number.isInteger(scene.outputHeight)).toBe(true);

		const [, framingTy] = framing.projection.translate();
		const [, sceneTy] = scene.projection.translate();
		expect(sceneTy - framingTy).toBe(scene.outputHeight - framing.outputHeight);
	});
});
