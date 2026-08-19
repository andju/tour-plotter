import { describe, expect, it } from 'vitest';
import type { BasemapLayers } from '../basemap/types';
import type { Track } from '../gpx/types';
import { buildSceneInput, computeFraming, type BuildSceneOptions } from './buildSceneInput';
import { DEFAULT_SCENE_STYLE } from './defaultStyle';
import { descriptionBandHeightPx, reservedBandPx, titleBandHeightPx } from './scene';

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
		attribution: '© Natural Earth',
		hasDetailLevels: true
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
		minCoverageKm: 25,
		hasTitle: false,
		hasDescription: false
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
		expect(scene.reservedTopPx).toBe(0);
	});

	it('keeps outputHeight exactly the requested height when a title is set — the band is reserved inside the fit, not by growing the canvas', () => {
		const framing = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: false
		})!;
		const scene = buildSceneInput(baseOptions({ framing, title: 'Alpine Loop' }));

		expect(scene.outputHeight).toBe(1000);
		expect(scene.outputWidth).toBe(1000);
		expect(scene.projection).toBe(framing.projection);
	});

	it('Framing.reservedTopPx matches reservedBandPx for the requested title/description presence', () => {
		const scale = 1000 / 1000;

		const titleOnly = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: false
		})!;
		expect(titleOnly.reservedTopPx).toBe(
			reservedBandPx({ title: 'x', description: null }, DEFAULT_SCENE_STYLE, scale)
		);

		const titleAndDescription = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: true
		})!;
		expect(titleAndDescription.reservedTopPx).toBe(
			reservedBandPx({ title: 'x', description: 'x' }, DEFAULT_SCENE_STYLE, scale)
		);
	});

	it('reserves room for the band by shrinking the map fit, not by shifting a taller canvas', () => {
		const width = 1000;
		const height = 1000;
		const without = computeFraming({
			width,
			height,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: false,
			hasDescription: false
		})!;
		const withTitle = computeFraming({
			width,
			height,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: true
		})!;

		expect(withTitle.outputHeight).toBe(without.outputHeight);
		expect(withTitle.marginPx).toBe(without.marginPx);
		expect(withTitle.reservedTopPx).toBeGreaterThan(0);

		// The bbox's own top edge (maxLat) must project below the reserved
		// band + margin, not above it — the fit treats that space as
		// unavailable rather than letting the map bleed into it.
		const [, , , maxLat] = withTitle.bbox;
		const centerLon = (withTitle.bbox[0] + withTitle.bbox[2]) / 2;
		const [, topY] = withTitle.projection([centerLon, maxLat])!;
		expect(topY).toBeGreaterThanOrEqual(withTitle.reservedTopPx + withTitle.marginPx - 1e-6);
	});

	it('visibleBbox covers the full canvas including the reserved band, so the basemap fetch covers it too', () => {
		const width = 1000;
		const height = 1000;
		const framing = computeFraming({
			width,
			height,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: true
		})!;

		// y = 0 is the very top of the canvas, inside the reserved band.
		const [lon, lat] = framing.projection.invert!([width / 2, 0])!;
		expect(lon).toBeCloseTo(framing.visibleBbox[0] + (framing.visibleBbox[2] - framing.visibleBbox[0]) / 2, 5);
		expect(lat).toBeCloseTo(framing.visibleBbox[3], 5);
	});

	it('computeFraming depends on title/description presence, not their text', () => {
		const withoutText = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: false,
			hasDescription: false
		});
		const alsoWithoutText = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: false,
			hasDescription: false
		});
		const withTitle = computeFraming({
			width: 1000,
			height: 1000,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: false
		});

		expect(withoutText!.outputHeight).toBe(alsoWithoutText!.outputHeight);
		expect(withoutText!.reservedTopPx).toBe(alsoWithoutText!.reservedTopPx);
		expect(withoutText!.reservedTopPx).not.toBe(withTitle!.reservedTopPx);
	});

	// Regression coverage for the historical "pushed down / blank strip" bug:
	// with a title/description set, the map used to be pushed into a taller
	// canvas whose new top strip had no basemap data fetched for it. Now the
	// canvas never grows, so there's nothing to regress here beyond what the
	// tests above already assert — this test only pins the exact numbers so a
	// future change to titleBandHeightPx/descriptionBandHeightPx is visible.
	it('reserves exactly titleBandHeightPx + descriptionBandHeightPx (scaled) when both are set', () => {
		const scale = 600 / 1000;
		const framing = computeFraming({
			width: 600,
			height: 800,
			visibleTracks: [track],
			minCoverageKm: 25,
			hasTitle: true,
			hasDescription: true
		})!;

		const expected = (titleBandHeightPx(DEFAULT_SCENE_STYLE) + descriptionBandHeightPx(DEFAULT_SCENE_STYLE)) * scale;
		expect(framing.reservedTopPx).toBeCloseTo(expected, 5);
	});
});
