import { DEFAULT_SCENE_STYLE } from './defaultStyle';
import type { SceneStyle } from './scene';

/**
 * Map style presets. This app decodes OSM vector tiles itself and draws them
 * with d3-geo (see render/scene.ts's header comment) rather than rendering
 * MapLibre style JSON, so a preset here is a hand-transcribed colour palette
 * — background/water/urban/park/border/label colours — rather than the OFM
 * style verbatim. Each palette below is derived from the live style JSON at
 * https://tiles.openfreemap.org/styles/<id> (fetched during design; re-sync
 * by diffing that JSON's `background`/`water`/`park`/`landuse_residential`/
 * `landcover_wood`/`boundary_2`/`boundary_3`/`place_*` layers against the
 * table here). Only colours vary between palettes — stroke widths, dot radii
 * and font sizes stay shared via DEFAULT_SCENE_STYLE so the 1000px-reference
 * scale invariant (scene.ts) is untouched by a style switch.
 */
export type MapStyleId = 'classic' | 'liberty' | 'bright' | 'positron' | 'dark' | 'fiord';

export interface MapStyleOption {
	id: MapStyleId;
	label: string;
	style: SceneStyle;
}

type PaletteColors = Pick<
	SceneStyle,
	| 'backgroundFill'
	| 'landFill'
	| 'coastlineStroke'
	| 'waterFill'
	| 'waterStroke'
	| 'waterwayStroke'
	| 'urbanFill'
	| 'parkFill'
	| 'admin0Stroke'
	| 'admin1Stroke'
	| 'cityDotFill'
	| 'textColor'
	| 'textHalo'
	| 'trackCasing'
	| 'scaleBarColor'
>;

function palette(colors: PaletteColors): SceneStyle {
	return { ...DEFAULT_SCENE_STYLE, ...colors };
}

// OpenFreeMap "Liberty" — layers `background`, `water`, `landuse_residential`,
// `landcover_wood`, `boundary_2`/`boundary_3`, `water_name_point_label`.
const LIBERTY = palette({
	backgroundFill: '#9ebdff',
	landFill: '#f8f4f0',
	coastlineStroke: '#7fa6ee',
	waterFill: '#9ebdff',
	waterStroke: '#7fa6ee',
	waterwayStroke: '#a0c8f0',
	urbanFill: '#e0dbda',
	parkFill: '#d8e8c8',
	admin0Stroke: '#686869',
	admin1Stroke: '#b3b3b3',
	cityDotFill: '#3b4a6b',
	textColor: '#333333',
	textHalo: '#ffffff',
	trackCasing: '#ffffff',
	scaleBarColor: '#333333'
});

// OpenFreeMap "Bright" — layers `background`, `water`, `landuse-residential`,
// `landcover-wood`, `boundary_2`/`boundary_3`, `water_name_point_label`.
const BRIGHT = palette({
	backgroundFill: '#aecfe2',
	landFill: '#f8f4f0',
	coastlineStroke: '#93bad3',
	waterFill: '#aecfe2',
	waterStroke: '#93bad3',
	waterwayStroke: '#a0c8f0',
	urbanFill: '#f2eee9',
	parkFill: '#d8e8c8',
	admin0Stroke: '#a4a4ad',
	admin1Stroke: '#b3b3b3',
	cityDotFill: '#495e91',
	textColor: '#333333',
	textHalo: '#ffffff',
	trackCasing: '#ffffff',
	scaleBarColor: '#333333'
});

// OpenFreeMap "Positron" — layers `background`, `water`, `landuse_residential`,
// `landcover_wood`, `boundary_2`/`boundary_3`, `waterway_line_label`.
const POSITRON = palette({
	backgroundFill: '#c2c8ca',
	landFill: '#f2f3f0',
	coastlineStroke: '#adb5b8',
	waterFill: '#c2c8ca',
	waterStroke: '#adb5b8',
	waterwayStroke: '#c0cdd1',
	urbanFill: '#eaeae6',
	parkFill: '#e6e9e5',
	admin0Stroke: '#b3b3b3',
	admin1Stroke: '#c9c9c9',
	cityDotFill: '#4d4d4d',
	textColor: '#3d3d3d',
	textHalo: '#ffffff',
	trackCasing: '#ffffff',
	scaleBarColor: '#3d3d3d'
});

// OpenFreeMap "Dark" — layers `background`, `water`, `landuse_residential`,
// `landcover_wood`, `boundary_state`/`boundary_country_*`, `place_*`.
const DARK = palette({
	backgroundFill: '#1b1b1d',
	landFill: '#0c0c0c',
	coastlineStroke: '#2a2a2e',
	waterFill: '#1b1b1d',
	waterStroke: '#2a2a2e',
	waterwayStroke: '#2f2f33',
	urbanFill: '#0d0c0c',
	parkFill: '#202020',
	admin0Stroke: '#3b3b3b',
	admin1Stroke: '#363636',
	cityDotFill: '#b4b4b4',
	textColor: '#d5d5d5',
	textHalo: '#0c0c0c',
	trackCasing: '#3a3a3a',
	scaleBarColor: '#d5d5d5'
});

// OpenFreeMap "Fiord" — layers `background`, `water`, `park`,
// `boundary_state`/`boundary_country_*`, `place_*`. `landuse_residential` in
// the live style is a light-theme leftover (`rgb(234,234,230)`, a near-white
// blob on this navy background) and is deliberately overridden here rather
// than transcribed verbatim.
const FIORD = palette({
	backgroundFill: '#38435c',
	landFill: '#45516e',
	coastlineStroke: '#303a51',
	waterFill: '#38435c',
	waterStroke: '#303a51',
	waterwayStroke: '#373d58',
	urbanFill: '#4c5878',
	parkFill: '#4a5866',
	admin0Stroke: '#9dbdf2',
	admin1Stroke: '#5a6b86',
	cityDotFill: '#b3c9d1',
	textColor: '#cfe0e8',
	textHalo: '#1b2547',
	trackCasing: '#2c3550',
	scaleBarColor: '#cfe0e8'
});

export const MAP_STYLES: readonly MapStyleOption[] = [
	{ id: 'classic', label: 'Classic', style: DEFAULT_SCENE_STYLE },
	{ id: 'liberty', label: 'Liberty', style: LIBERTY },
	{ id: 'bright', label: 'Bright', style: BRIGHT },
	{ id: 'positron', label: 'Positron', style: POSITRON },
	{ id: 'dark', label: 'Dark', style: DARK },
	{ id: 'fiord', label: 'Fiord', style: FIORD }
];

export const DEFAULT_MAP_STYLE: MapStyleId = 'classic';

const STYLES_BY_ID = new Map(MAP_STYLES.map((option) => [option.id, option.style]));

/** Falls back to the classic palette for an id that isn't (or is no longer) in MAP_STYLES. */
export function sceneStyleFor(id: MapStyleId): SceneStyle {
	return STYLES_BY_ID.get(id) ?? DEFAULT_SCENE_STYLE;
}
