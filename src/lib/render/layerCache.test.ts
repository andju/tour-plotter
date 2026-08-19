import { describe, expect, it } from 'vitest';
import type { BasemapLayers } from '../basemap/types';
import { buildProjection, visibleBbox } from '../geo/projection';
import { basemapLayerKey, overlayLayerKey } from './layerCache';
import type { OverlaySettings, SceneInput, SceneStyle } from './scene';

const bbox: [number, number, number, number] = [13.0, 52.0, 13.5, 52.5];

const style: SceneStyle = {
	backgroundFill: '#ffffff',
	landFill: '#eeeeee',
	coastlineStroke: '#999999',
	waterFill: '#cceeff',
	waterStroke: '#88bbdd',
	waterwayStroke: '#88bbdd',
	urbanFill: '#dddddd',
	parkFill: '#ccddcc',
	admin0Stroke: '#666666',
	admin1Stroke: '#aaaaaa',
	cityDotFill: '#000000',
	textColor: '#111111',
	textHalo: '#ffffff',
	trackCasing: '#ffffff',
	scaleBarColor: '#111111',
	fontFamily: 'sans-serif',
	referenceStrokeWidthPx: { coastline: 2, water: 1, waterway: 1, admin0: 1.5, admin1: 1, trackCasingExtra: 2 },
	referenceCityDotRadiusPx: { largest: 4, smallest: 1.5 },
	referenceFontSizePx: { cityLargest: 13, citySmallest: 8.5, title: 24, stats: 14, credit: 10, scaleBar: 10 }
};

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

const overlay: OverlaySettings = {
	title: 'Test Map',
	titlePosition: 'top-center',
	statsText: '10 km',
	showAdmin1: true,
	showCredit: true,
	showScaleBar: true,
	detailBias: 'rich',
	cityLabelLanguage: 'en',
	citySize: 5
};

const measureTextWidth = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

function sceneInput(overrides: Partial<SceneInput> = {}): SceneInput {
	const projection = buildProjection(1000, 1000, bbox, 20);
	return {
		outputWidth: 1000,
		outputHeight: 1000,
		marginPx: 20,
		projection,
		visibleBbox: visibleBbox(projection, 1000, 1000),
		basemap: emptyBasemap(),
		tracks: [
			{
				id: 't1',
				name: 'Sample',
				segments: [[{ lon: 13.1, lat: 52.1, ele: null, time: null }]],
				style: { color: '#ff0000', widthPx: 3, opacity: 1, visible: true }
			}
		],
		overlay,
		style,
		measureTextWidth,
		...overrides
	};
}

describe('basemapLayerKey', () => {
	it('is unchanged by per-track style edits', () => {
		const base = sceneInput();
		const edited = sceneInput({
			basemap: base.basemap,
			projection: base.projection,
			tracks: [{ ...base.tracks[0], style: { color: '#00ff00', widthPx: 9, opacity: 0.2, visible: true } }]
		});

		expect(basemapLayerKey(edited)).toBe(basemapLayerKey(base));
	});

	it('changes when showAdmin1 changes', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, showAdmin1: false } });
		expect(basemapLayerKey(edited)).not.toBe(basemapLayerKey(base));
	});

	it('changes when detailBias changes', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, detailBias: 'minimal' } });
		expect(basemapLayerKey(edited)).not.toBe(basemapLayerKey(base));
	});

	it('is unaffected by detailBias when the source has no detail levels', () => {
		const noDetailBasemap = { ...emptyBasemap(), hasDetailLevels: false };
		const base = sceneInput({ basemap: noDetailBasemap });
		const edited = sceneInput({
			...base,
			overlay: { ...overlay, detailBias: 'minimal' }
		});
		expect(basemapLayerKey(edited)).toBe(basemapLayerKey(base));
	});

	it('is unaffected by citySize, cityLabelLanguage, title or statsText', () => {
		const base = sceneInput();
		const edited = sceneInput({
			...base,
			overlay: { ...overlay, citySize: 10, cityLabelLanguage: 'de', title: 'Other Title', statsText: '20 km' }
		});
		expect(basemapLayerKey(edited)).toBe(basemapLayerKey(base));
	});

	it('changes for a new projection instance', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, projection: buildProjection(1000, 1000, bbox, 20) });
		expect(basemapLayerKey(edited)).not.toBe(basemapLayerKey(base));
	});

	it('changes for a new basemap object', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, basemap: emptyBasemap() });
		expect(basemapLayerKey(edited)).not.toBe(basemapLayerKey(base));
	});

	it('changes for a new style object (e.g. a map style switch)', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, style: { ...style } });
		expect(basemapLayerKey(edited)).not.toBe(basemapLayerKey(base));
	});
});

describe('overlayLayerKey', () => {
	it('is unchanged by per-track style edits', () => {
		const base = sceneInput();
		const edited = sceneInput({
			basemap: base.basemap,
			projection: base.projection,
			tracks: [{ ...base.tracks[0], style: { color: '#00ff00', widthPx: 9, opacity: 0.2, visible: true } }]
		});

		expect(overlayLayerKey(edited)).toBe(overlayLayerKey(base));
	});

	it('changes when citySize changes', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, citySize: 10 } });
		expect(overlayLayerKey(edited)).not.toBe(overlayLayerKey(base));
	});

	it('is unaffected by the title (the title text belongs to the uncached "text" phase)', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, title: 'Other Title' } });
		expect(overlayLayerKey(edited)).toBe(overlayLayerKey(base));
	});

	it('is unaffected by titlePosition (it belongs to the uncached "text" phase, same as the title text)', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, titlePosition: 'bottom-right' } });
		expect(overlayLayerKey(edited)).toBe(overlayLayerKey(base));
	});

	it('changes when statsText changes', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, statsText: '20 km' } });
		expect(overlayLayerKey(edited)).not.toBe(overlayLayerKey(base));
	});

	it('is unaffected by showAdmin1 or detailBias', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, overlay: { ...overlay, showAdmin1: false, detailBias: 'minimal' } });
		expect(overlayLayerKey(edited)).toBe(overlayLayerKey(base));
	});

	it('changes for a new projection instance', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, projection: buildProjection(1000, 1000, bbox, 20) });
		expect(overlayLayerKey(edited)).not.toBe(overlayLayerKey(base));
	});

	it('changes for a new basemap object', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, basemap: emptyBasemap() });
		expect(overlayLayerKey(edited)).not.toBe(overlayLayerKey(base));
	});

	it('changes for a new style object (e.g. a map style switch)', () => {
		const base = sceneInput();
		const edited = sceneInput({ ...base, style: { ...style } });
		expect(overlayLayerKey(edited)).not.toBe(overlayLayerKey(base));
	});
});
