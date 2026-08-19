import { describe, expect, it } from 'vitest';
import type { BasemapLayers } from '../basemap/types';
import type { Bbox } from '../geo/bbox';
import { buildProjection, visibleBbox } from '../geo/projection';
import type { Track } from '../gpx/types';
import { composeScene, composeScenePhase, SCENE_PHASES, type OverlaySettings, type SceneInput, type SceneStyle } from './scene';
import { SvgRenderer } from './svg';

const bbox: Bbox = [13.0, 52.0, 13.5, 52.5];

const style: SceneStyle = {
	backgroundFill: '#e5f0ff',
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
	minimapMarkerColor: '#f44336',
	trackCasing: '#ffffff',
	scaleBarColor: '#111111',
	fontFamily: 'sans-serif',
	referenceStrokeWidthPx: { coastline: 2, water: 1, waterway: 1, admin0: 1.5, admin1: 1, trackCasingExtra: 2 },
	referenceCityDotRadiusPx: { largest: 4, smallest: 1.5 },
	referenceFontSizePx: { cityLargest: 13, citySmallest: 8.5, title: 24, stats: 14, credit: 10, scaleBar: 10 },
	referenceMinimapPx: {
		width: 60,
		innerMarginPx: 4,
		frameStroke: 1.5,
		landStroke: 0.5,
		adminStroke: 0.7,
		markerStroke: 1.5,
		markerMinSizePx: 6,
		markerDotRadius: 3
	}
};

function naturalEarthBasemap(): BasemapLayers {
	return {
		baseFill: 'water',
		land: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[13.0, 52.0],
								[13.5, 52.0],
								[13.5, 52.5],
								[13.0, 52.5],
								[13.0, 52.0]
							]
						]
					}
				}
			]
		},
		water: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { min_zoom: 2 },
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[13.15, 52.15],
								[13.2, 52.15],
								[13.2, 52.2],
								[13.15, 52.15]
							]
						]
					}
				}
			]
		},
		waterways: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [[13.05, 52.05], [13.1, 52.1]] }
				}
			]
		},
		urban: { type: 'FeatureCollection', features: [] },
		parks: { type: 'FeatureCollection', features: [] },
		admin0: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [[13.2, 52.0], [13.2, 52.5]] }
				}
			]
		},
		admin1: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [[13.0, 52.2], [13.5, 52.2]] }
				}
			]
		},
		places: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { name: 'Testville', rank: 0, size: 0 },
					geometry: { type: 'Point', coordinates: [13.25, 52.25] }
				}
			]
		},
		attribution: '© Natural Earth',
		hasDetailLevels: true
	};
}

/** A single coarse land polygon, standing in for static/basemap/world-land.json in tests. */
function worldLandFixture(): GeoJSON.FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[-10, 35],
							[40, 35],
							[40, 70],
							[-10, 70],
							[-10, 35]
						]
					]
				}
			}
		]
	};
}

/** A single coarse admin0 border line, standing in for static/basemap/world-admin0.json in tests. */
function worldAdmin0Fixture(): GeoJSON.FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: [[15, 35], [15, 70]] }
			}
		]
	};
}

function basemapWithPlaces(
	features: GeoJSON.Feature<GeoJSON.Point, { name: string; rank: number; size: number }>[]
): BasemapLayers {
	return { ...naturalEarthBasemap(), places: { type: 'FeatureCollection', features } };
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

const overlay: OverlaySettings = {
	title: 'Test Map',
	titlePosition: 'top-center',
	statsText: '10 km',
	showAdmin1: true,
	showCredit: true,
	showScaleBar: true,
	detailBias: 'rich',
	cityLabelLanguage: 'en',
	citySize: 10,
	showMinimap: false,
	minimapPosition: 'bottom-right',
	minimapCoverageKm: 5000
};

// Deterministic stand-in for Canvas-based measurement (unavailable under jsdom).
const measureTextWidth = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

interface SceneInputOverrides {
	overlay?: Partial<OverlaySettings>;
	worldLand?: GeoJSON.FeatureCollection | null;
	worldAdmin0?: GeoJSON.FeatureCollection | null;
}

function sceneInputAt(outputWidth: number, outputHeight: number, overrides: SceneInputOverrides = {}): SceneInput {
	const marginPx = 20 * (outputWidth / 1000);
	const projection = buildProjection(outputWidth, outputHeight, bbox, marginPx);
	return {
		outputWidth,
		outputHeight,
		marginPx,
		projection,
		visibleBbox: visibleBbox(projection, outputWidth, outputHeight),
		basemap: naturalEarthBasemap(),
		tracks: [track],
		overlay: { ...overlay, ...overrides.overlay },
		style,
		measureTextWidth,
		worldLand: overrides.worldLand ?? null,
		worldAdmin0: overrides.worldAdmin0 ?? null
	};
}

function renderAt(outputWidth: number, outputHeight: number, overrides: SceneInputOverrides = {}) {
	const input = sceneInputAt(outputWidth, outputHeight, overrides);
	const renderer = new SvgRenderer(outputWidth, outputHeight, input.projection);
	composeScene(renderer, input);
	return renderer.serialize();
}

function numbersFor(svg: string, attr: string): number[] {
	return [...svg.matchAll(new RegExp(`${attr}="(-?[\\d.]+)"`, 'g'))].map((m) => Number(m[1]));
}

/** Stroke widths on <path> elements only — text labels also carry a
 * stroke-width (their halo), which would otherwise pollute a plain
 * `numbersFor(svg, 'stroke-width')` count. */
function pathStrokeWidths(svg: string): number[] {
	const paths = svg.match(/<path[^>]*\/>/g) ?? [];
	return paths.flatMap((p) => numbersFor(p, 'stroke-width'));
}

function numericBbox(pathData: string): { width: number; height: number } {
	const nums = pathData.match(/-?[\d.]+/g)!.map(Number);
	const xs = nums.filter((_, i) => i % 2 === 0);
	const ys = nums.filter((_, i) => i % 2 === 1);
	return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

describe('composeScene — scale invariant', () => {
	const small = renderAt(1000, 1000);
	const large = renderAt(2000, 2000);

	it('doubles stroke widths', () => {
		const smallWidths = numbersFor(small, 'stroke-width');
		const largeWidths = numbersFor(large, 'stroke-width');
		expect(largeWidths).toHaveLength(smallWidths.length);
		smallWidths.forEach((w, i) => expect(largeWidths[i]).toBeCloseTo(w * 2, 5));
	});

	it('doubles font sizes', () => {
		const smallSizes = numbersFor(small, 'font-size');
		const largeSizes = numbersFor(large, 'font-size');
		expect(largeSizes).toHaveLength(smallSizes.length);
		smallSizes.forEach((s, i) => expect(largeSizes[i]).toBeCloseTo(s * 2, 5));
	});

	it('doubles the city dot radius', () => {
		const smallR = numbersFor(small, 'r');
		const largeR = numbersFor(large, 'r');
		expect(largeR).toHaveLength(smallR.length);
		smallR.forEach((r, i) => expect(largeR[i]).toBeCloseTo(r * 2, 5));
	});

	it('doubles the bounding box of the track path', () => {
		// Compares bbox rather than raw coordinate lists: d3-geo's adaptive
		// resampling of great-circle edges can emit a different number of
		// intermediate points at different scales even when the underlying
		// geographic extent is identical. Bbox is invariant to that. Uses
		// the track (a plain 2-point line, drawn twice — casing then color,
		// so the last two paths) rather than the basemap polygons, which
		// pick up more resampling noise from their curved edges and aren't
		// the thing this test is about.
		const smallD = [...small.matchAll(/d="([^"]+)"/g)].map((m) => m[1]).at(-1)!;
		const largeD = [...large.matchAll(/d="([^"]+)"/g)].map((m) => m[1]).at(-1)!;
		const smallBox = numericBbox(smallD);
		const largeBox = numericBbox(largeD);
		expect(largeBox.width).toBeCloseTo(smallBox.width * 2, 1);
		expect(largeBox.height).toBeCloseTo(smallBox.height * 2, 1);
	});

	it('positions overlay text at doubled coordinates', () => {
		const smallX = numbersFor(small, 'x');
		const largeX = numbersFor(large, 'x');
		expect(largeX).toHaveLength(smallX.length);
		smallX.forEach((x, i) => expect(largeX[i]).toBeCloseTo(x * 2, 5));
	});
});

describe('composeScene — layer toggles', () => {
	it('omits admin1 borders when showAdmin1 is false', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: naturalEarthBasemap(),
			tracks: [],
			overlay: { ...overlay, showAdmin1: false, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		const svg = renderer.serialize();
		// Coastline (from land fill/stroke split) + water + waterway + admin0
		// each contribute exactly one stroked path in this fixture.
		expect(pathStrokeWidths(svg)).toHaveLength(4);
	});

	it('skips invisible tracks', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		const hidden: Track = { ...track, style: { ...track.style, visible: false } };
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: naturalEarthBasemap(),
			tracks: [hidden],
			overlay: { ...overlay, showAdmin1: false, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		expect(renderer.serialize()).not.toContain(hidden.style.color);
	});

	it('never strokes water polygons when baseFill is land (tiled data has no seam-free outline)', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		const tiledBasemap: BasemapLayers = { ...naturalEarthBasemap(), baseFill: 'land', land: null };
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: tiledBasemap,
			tracks: [],
			overlay: { ...overlay, showAdmin1: false, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		// Only the waterway line and admin0 border should carry a stroke —
		// the water polygon must be fill-only.
		expect(pathStrokeWidths(renderer.serialize())).toHaveLength(2);
	});
});

describe('composeScene — viewport culling', () => {
	function urbanFeature(coordinates: [number, number][]): GeoJSON.Feature {
		return {
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
		};
	}

	it('draws a feature inside the visible extent and drops one entirely outside it', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		const inside = urbanFeature([
			[13.2, 52.2],
			[13.25, 52.2],
			[13.25, 52.25],
			[13.2, 52.25]
		]);
		// Far from `bbox` ([13.0, 52.0, 13.5, 52.5]) on both axes — nowhere
		// near the framing's visible extent even with margin slack.
		const outside = urbanFeature([
			[100, 0],
			[101, 0],
			[101, 1],
			[100, 1]
		]);
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: {
				...naturalEarthBasemap(),
				urban: { type: 'FeatureCollection', features: [inside, outside] }
			},
			tracks: [],
			overlay: { ...overlay, showAdmin1: false, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		const urbanPaths = [...renderer.serialize().matchAll(new RegExp(`fill="${style.urbanFill}"`, 'g'))];
		expect(urbanPaths).toHaveLength(1);
	});
});

describe('composeScene — places', () => {
	function renderPlaces(features: GeoJSON.Feature<GeoJSON.Point, { name: string; rank: number; size: number }>[]) {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: basemapWithPlaces(features),
			tracks: [],
			overlay: { ...overlay, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		return renderer.serialize();
	}

	const feature = (
		name: string,
		rank: number,
		size: number,
		coordinates: [number, number]
	): GeoJSON.Feature<GeoJSON.Point, { name: string; rank: number; size: number }> => ({
		type: 'Feature',
		properties: { name, rank, size },
		geometry: { type: 'Point', coordinates }
	});

	it('omits a place whose size exceeds the citySize cutoff', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: basemapWithPlaces([feature('Kept', 0, 5, [13.2, 52.2]), feature('Dropped', 0, 6, [13.3, 52.3])]),
			tracks: [],
			overlay: { ...overlay, citySize: 5, title: null, statsText: null, showCredit: false, showScaleBar: false },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		const svg = renderer.serialize();
		expect(svg).toContain('Kept');
		expect(svg).not.toContain('Dropped');
	});

	it('culls a place whose projected position falls outside the canvas', () => {
		const svg = renderPlaces([feature('OnCanvas', 0, 0, [13.25, 52.25]), feature('OffCanvas', 0, 0, [170, 80])]);
		expect([...svg.matchAll(/<circle/g)]).toHaveLength(1);
		expect(svg).toContain('OnCanvas');
		expect(svg).not.toContain('OffCanvas');
	});

	it('draws a larger dot and label for a smaller-size (more prominent) place', () => {
		const svg = renderPlaces([feature('Big', 0, 0, [13.1, 52.4]), feature('Small', 0, 9, [13.4, 52.1])]);
		const radii = numbersFor(svg, 'r');
		const fontSizes = numbersFor(svg, 'font-size').filter((s) => s < style.referenceFontSizePx.title);

		expect(radii).toHaveLength(2);
		expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
		expect(fontSizes).toHaveLength(2);
		expect(Math.max(...fontSizes)).toBeGreaterThan(Math.min(...fontSizes));
	});

});

describe('composeScene — phase composition', () => {
	it('produces markup identical to running each phase in order', () => {
		const input = sceneInputAt(1000, 1000);
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		for (const phase of SCENE_PHASES) composeScenePhase(renderer, input, phase);

		expect(renderer.serialize()).toBe(renderAt(1000, 1000));
	});

	it("'basemap' phase draws the background but no tracks or overlay text", () => {
		const input = sceneInputAt(1000, 1000);
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		composeScenePhase(renderer, input, 'basemap');

		const svg = renderer.serialize();
		expect(svg).toContain(`fill="${style.backgroundFill}"`);
		expect(svg).not.toContain('<text');
		expect(svg).not.toContain(track.style.color);
	});

	it("'tracks' phase draws only the track paths", () => {
		const input = sceneInputAt(1000, 1000);
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		composeScenePhase(renderer, input, 'tracks');

		const svg = renderer.serialize();
		// Casing pass + colour pass, nothing else.
		expect([...svg.matchAll(/<path/g)]).toHaveLength(2);
		expect(svg).toContain(track.style.color);
		expect(svg).not.toContain('<text');
		expect(svg).not.toContain('<circle');
	});

	it("'overlay' phase draws city labels/credit but no basemap fill, tracks, or title", () => {
		const input = sceneInputAt(1000, 1000);
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		composeScenePhase(renderer, input, 'overlay');

		const svg = renderer.serialize();
		expect(svg).toContain('<text');
		expect(svg).toContain('Testville');
		expect(svg).not.toContain(`fill="${style.backgroundFill}"`);
		expect(svg).not.toContain(track.style.color);
		expect(svg).not.toContain('>Test Map<');
	});

	it("'minimap' phase draws only the inset panel/land/admin0, nothing from other phases", () => {
		const input = sceneInputAt(1000, 1000, {
			overlay: { showMinimap: true },
			worldLand: worldLandFixture(),
			worldAdmin0: worldAdmin0Fixture()
		});
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		composeScenePhase(renderer, input, 'minimap');

		const svg = renderer.serialize();
		expect(svg).toContain(`fill="${style.landFill}"`);
		expect(svg).not.toContain('<text');
		expect(svg).not.toContain(track.style.color);
		expect(svg).not.toContain('Testville');
	});

	it("'text' phase draws the positioned title pill but no city labels, credit, or tracks", () => {
		const input = sceneInputAt(1000, 1000);
		const renderer = new SvgRenderer(1000, 1000, input.projection);
		composeScenePhase(renderer, input, 'text');

		const svg = renderer.serialize();
		expect(svg).toContain('>Test Map<');
		expect(svg).not.toContain('Testville');
		expect(svg).not.toContain('© Natural Earth');
		expect(svg).not.toContain('<circle');
		expect(svg).not.toContain(track.style.color);
	});
});

describe('composeScene — minimap', () => {
	it('omits the minimap entirely when showMinimap is false', () => {
		expect(renderAt(1000, 1000, { worldLand: worldLandFixture() })).toBe(renderAt(1000, 1000));
	});

	it('omits the minimap when worldLand has not loaded yet, even if enabled', () => {
		expect(renderAt(1000, 1000, { overlay: { showMinimap: true } })).toBe(renderAt(1000, 1000));
	});

	it('draws a land-filled panel and a frame when enabled with worldLand present', () => {
		const svg = renderAt(1000, 1000, { overlay: { showMinimap: true }, worldLand: worldLandFixture() });
		expect(svg).toContain(`fill="${style.landFill}"`);
		expect(svg).toContain(`stroke="${style.admin0Stroke}"`);
	});

	it('draws an extra admin0-stroked path when worldAdmin0 is present, on top of the frame', () => {
		const countAdmin0Strokes = (svg: string) => (svg.match(new RegExp(`stroke="${style.admin0Stroke}"`, 'g')) ?? []).length;
		const withoutAdmin0 = renderAt(1000, 1000, { overlay: { showMinimap: true }, worldLand: worldLandFixture() });
		const withAdmin0 = renderAt(1000, 1000, {
			overlay: { showMinimap: true },
			worldLand: worldLandFixture(),
			worldAdmin0: worldAdmin0Fixture()
		});
		expect(countAdmin0Strokes(withAdmin0)).toBe(countAdmin0Strokes(withoutAdmin0) + 1);
	});

	describe('scale invariant', () => {
		function withMinimap(outputWidth: number, outputHeight: number) {
			return renderAt(outputWidth, outputHeight, {
				overlay: { showMinimap: true },
				worldLand: worldLandFixture(),
				worldAdmin0: worldAdmin0Fixture()
			});
		}
		const small = withMinimap(1000, 1000);
		const large = withMinimap(2000, 2000);

		it('doubles every stroke width, including the inset frame and land outline', () => {
			const smallWidths = numbersFor(small, 'stroke-width');
			const largeWidths = numbersFor(large, 'stroke-width');
			expect(largeWidths).toHaveLength(smallWidths.length);
			smallWidths.forEach((w, i) => expect(largeWidths[i]).toBeCloseTo(w * 2, 5));
		});

		it('doubles every rect width/height, including the inset panel and marker', () => {
			// Precision 2, not 5 like the plain-multiplication stroke-width check
			// above: the marker rect is derived from two independently projected
			// corners (min/max + a clamp), which accumulates a little more
			// floating-point noise than a single `value * scale`.
			const smallSizes = [...numbersFor(small, 'width'), ...numbersFor(small, 'height')];
			const largeSizes = [...numbersFor(large, 'width'), ...numbersFor(large, 'height')];
			expect(largeSizes).toHaveLength(smallSizes.length);
			smallSizes.forEach((s, i) => expect(largeSizes[i]).toBeCloseTo(s * 2, 2));
		});
	});
});

describe('composeScene — title background', () => {
	it('paints a neutral rect behind the title, sized to the text rather than the full row, anchored per titlePosition', () => {
		const svg = renderAt(1000, 1000);
		// title font-size is 24 at the 1000px reference; box height = 24 * 1.5 = 36.
		// 'Test Map' is 8 chars, measureTextWidth stub gives 8 * 24 * 0.5 = 96 wide;
		// + 2 * (24 * 0.5) padding = 120 wide, centred on x=500 -> x=440.
		// marginPx at 1000 width is 20; 'top-center' anchors the box's vertical
		// centre at marginPx + boxHeight/2 = 20 + 18 = 38, so the box top is at y=20.
		expect(svg).toContain(`<rect x="440" y="20" width="120" height="36" fill="${style.textHalo}" />`);
		expect(svg).toContain('>Test Map<');
		// Definitely narrower than the full canvas width — the bug this guards against.
		expect(svg).not.toContain('width="1000" height="36"');
	});

	it('omits the background when no title is set', () => {
		const projection = buildProjection(1000, 1000, bbox, 20);
		const renderer = new SvgRenderer(1000, 1000, projection);
		composeScene(renderer, {
			outputWidth: 1000,
			outputHeight: 1000,
			marginPx: 20,
			projection,
			visibleBbox: visibleBbox(projection, 1000, 1000),
			basemap: naturalEarthBasemap(),
			tracks: [track],
			overlay: { ...overlay, title: null, showCredit: false, showScaleBar: false, statsText: null },
			style,
			measureTextWidth,
			worldLand: null,
			worldAdmin0: null
		});
		expect(renderer.serialize()).not.toContain(`fill="${style.textHalo}"`);
	});

	it('gives stats, scale bar and credit text a halo, not a filled background box', () => {
		const svg = renderAt(1000, 1000);
		const statsText = [...svg.matchAll(/<text[^>]*>10 km<\/text>/g)];
		const creditText = svg.match(/<text[^>]*>© Natural Earth<\/text>/);

		expect(statsText.length).toBeGreaterThan(0);
		for (const match of statsText) expect(match[0]).toContain(`stroke="${style.textHalo}"`);
		expect(creditText?.[0]).toContain(`stroke="${style.textHalo}"`);
	});

	it('keeps the title text itself free of a per-glyph halo (the background box is the backing)', () => {
		const svg = renderAt(1000, 1000);
		const titleText = svg.match(/<text[^>]*>Test Map<\/text>/);
		expect(titleText?.[0]).not.toContain('stroke=');
	});
});
