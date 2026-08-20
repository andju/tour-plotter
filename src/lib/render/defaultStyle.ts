import type { SceneStyle } from './scene';

export const DEFAULT_SCENE_STYLE: SceneStyle = {
	backgroundFill: '#dce8ef',
	landFill: '#eef0e8',
	coastlineStroke: '#9aa89a',
	waterFill: '#c8dce8',
	waterStroke: '#a8c4d4',
	waterwayStroke: '#a8c4d4',
	urbanFill: '#e4e2dc',
	parkFill: '#e3ebdd',
	admin0Stroke: '#b0a894',
	admin1Stroke: '#cfcabb',
	cityDotFill: '#5b5546',
	textColor: '#4a4a42',
	textHalo: '#ffffff',
	minimapMarkerColor: '#f44336',
	trackCasing: '#ffffff',
	scaleBarColor: '#4a4a42',
	fontFamily: 'Roboto, system-ui, sans-serif',
	monoFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
	referenceStrokeWidthPx: {
		coastline: 0.8,
		water: 0.5,
		waterway: 0.6,
		admin0: 1.8,
		admin1: 0.6,
		trackCasingExtra: 2
	},
	referenceCityDotRadiusPx: { largest: 4, smallest: 1.5 },
	referenceFontSizePx: {
		cityLargest: 13,
		citySmallest: 8.5,
		title: 28,
		stats: 14,
		credit: 10,
		scaleBar: 11
	},
	referenceMinimapPx: {
		width: 180,
		innerMarginPx: 6,
		frameStroke: 1.5,
		landStroke: 0.5,
		adminStroke: 0.8,
		markerStroke: 1.5,
		markerMinSizePx: 6,
		markerDotRadius: 3
	}
};
