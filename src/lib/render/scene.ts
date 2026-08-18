import type { GeoProjection } from 'd3-geo';
import { CITY_SIZE_MAX } from '../basemap/placeSize';
import type { BasemapLayers, PlaceProperties } from '../basemap/types';
import { trackToGeoJSON, type Track } from '../gpx/types';
import { visibleAt, zoomForProjection, type DetailBias } from './detail';
import { placeLabels, type LabelCandidate } from './labels';
import { computeScaleBar } from './scaleBar';
import type { Font, PathStyle, Renderer } from './renderer';

/**
 * Every length here is defined at a 1000px reference width. composeScene
 * multiplies them all by `outputWidth / 1000` before drawing, which is
 * what makes the preview a true proportional miniature of the export
 * (the WYSIWYG guarantee) instead of something that needs separate tuning
 * per resolution.
 */
export interface SceneStyle {
	backgroundFill: string;
	landFill: string;
	coastlineStroke: string;
	waterFill: string;
	waterStroke: string;
	waterwayStroke: string;
	urbanFill: string;
	parkFill: string;
	admin0Stroke: string;
	admin1Stroke: string;
	cityDotFill: string;
	textColor: string;
	textHalo: string;
	trackCasing: string;
	scaleBarColor: string;
	fontFamily: string;
	referenceStrokeWidthPx: {
		coastline: number;
		water: number;
		waterway: number;
		admin0: number;
		admin1: number;
		trackCasingExtra: number;
	};
	/** City dot radius tapers linearly across a place's size (PlaceProperties.size) — largest at size 0, smallest at CITY_SIZE_MAX. */
	referenceCityDotRadiusPx: { largest: number; smallest: number };
	referenceFontSizePx: {
		/** City label font size tapers linearly across a place's size, like referenceCityDotRadiusPx. */
		cityLargest: number;
		citySmallest: number;
		title: number;
		stats: number;
		credit: number;
		scaleBar: number;
	};
}

/**
 * Line-height multiplier applied to a reference font size to get the height
 * of one line of text plus a little breathing space above/below it. Shared
 * by `buildSceneInput.ts` (which reserves exactly this much extra canvas
 * height above the map for the title and description bands) and
 * `composeScenePhase` below (which sizes the neutral background box behind
 * title/description text to the same height) so the two can never drift apart.
 */
const TEXT_BAND_LINE_HEIGHT = 1.5;

/** Height (at the 1000px reference width) of the band reserved above the map for the title. */
export function titleBandHeightPx(style: SceneStyle): number {
	return style.referenceFontSizePx.title * TEXT_BAND_LINE_HEIGHT;
}

/** Height (at the 1000px reference width) of the band reserved for the description, directly below the title band (or at the top of the canvas if there's no title). */
export function descriptionBandHeightPx(style: SceneStyle): number {
	return style.referenceFontSizePx.stats * TEXT_BAND_LINE_HEIGHT;
}

export interface OverlaySettings {
	title: string | null;
	statsText: string | null;
	description: string | null;
	showAdmin1: boolean;
	showCredit: boolean;
	showScaleBar: boolean;
	detailBias: DetailBias;
	/** City-label language code (see basemap/languages.ts); falls back to each place's default name when unsupported by the source. */
	cityLabelLanguage: string;
	/** City-size slider value (0-CITY_SIZE_MAX), independent of detailBias — see basemap/placeSize.ts. */
	citySize: number;
}

export interface SceneInput {
	outputWidth: number;
	outputHeight: number;
	marginPx: number;
	projection: GeoProjection;
	basemap: BasemapLayers;
	/** Already filtered to the visible subset by the caller. */
	tracks: Track[];
	overlay: OverlaySettings;
	style: SceneStyle;
	measureTextWidth: (value: string, font: Font) => number;
}

/**
 * The three ordered groups `composeScene` draws in. Split out so the preview
 * can cache the two phases a per-track style edit (colour/width/opacity)
 * never touches — `basemap` and `overlay` — as bitmaps, and re-run only
 * `tracks` on a slider tick. See `layerCache.ts`.
 */
export type ScenePhase = 'basemap' | 'tracks' | 'overlay';
export const SCENE_PHASES: readonly ScenePhase[] = ['basemap', 'tracks', 'overlay'];

/**
 * Draws the full scene into `renderer`. Deliberately takes the Renderer
 * directly, rather than emitting an intermediate op list: every drawing
 * decision below is plain, ordered imperative code, and a Canvas render
 * and an SVG render of the same input only agree if they run the exact
 * same sequence of calls. Both CanvasRenderer and SvgRenderer call this
 * one function; neither has its own copy of the layout logic — that's
 * what makes PNG/SVG parity structural rather than a thing to test for.
 */
export function composeScene(renderer: Renderer, input: SceneInput): void {
	for (const phase of SCENE_PHASES) composeScenePhase(renderer, input, phase);
}

/** Draws one phase of `composeScene`. See `ScenePhase`. */
export function composeScenePhase(renderer: Renderer, input: SceneInput, phase: ScenePhase): void {
	const { outputWidth, projection, basemap, tracks, overlay, style } = input;
	const scale = outputWidth / 1000;
	const zoom = zoomForProjection(projection);
	const bias = overlay.detailBias;

	if (phase === 'basemap') {
		// 1. Background. OSM tiles carry no land polygon (ocean arrives as a
		// `water` feature), so the page itself starts as land; Natural Earth
		// carries an explicit land polygon over an implicit ocean, so the page
		// starts as water and land is painted on top at step 2.
		const backgroundFill = basemap.baseFill === 'land' ? style.landFill : style.backgroundFill;
		renderer.rect(0, 0, input.outputWidth, input.outputHeight, { fill: backgroundFill });

		// 2. Land (Natural Earth only), fill only — the coastline is stroked
		// separately at step 7, after water, so it reads as a crisp line on top
		// rather than blending into the fill's own edge.
		if (basemap.land) {
			for (const feature of basemap.land.features) {
				renderer.path(feature.geometry, { fill: style.landFill });
			}
		}

		// 3. Urban / landcover fills.
		for (const feature of filterByZoom(basemap.urban, zoom, bias)) {
			renderer.path(feature.geometry, { fill: style.urbanFill });
		}

		// 4. Parks.
		for (const feature of filterByZoom(basemap.parks, zoom, bias)) {
			renderer.path(feature.geometry, { fill: style.parkFill });
		}

		// 5. Water fills. Outline is only stroked in Natural Earth mode — MVT
		// polygons are clipped at tile boundaries, so stroking a tiled water
		// polygon's outline draws a visible seam along the tile grid.
		const waterStyle: PathStyle = { fill: style.waterFill };
		if (basemap.baseFill === 'water') {
			waterStyle.stroke = style.waterStroke;
			waterStyle.strokeWidthPx = style.referenceStrokeWidthPx.water * scale;
		}
		for (const feature of filterByZoom(basemap.water, zoom, bias)) {
			renderer.path(feature.geometry, waterStyle);
		}

		// 6. Waterway strokes — opaque, so tile-buffer overlap between adjacent
		// tiles (invisible for opaque strokes) doesn't need the same seam
		// avoidance as filled polygons.
		const waterwayStyle: PathStyle = {
			stroke: style.waterwayStroke,
			strokeWidthPx: style.referenceStrokeWidthPx.waterway * scale
		};
		for (const feature of filterByZoom(basemap.waterways, zoom, bias)) {
			renderer.path(feature.geometry, waterwayStyle);
		}

		// 7. Coastline (Natural Earth only) — land's own outline, stroked now
		// that water has been painted, so it reads as a crisp line on top.
		if (basemap.land) {
			const coastlineStyle: PathStyle = {
				stroke: style.coastlineStroke,
				strokeWidthPx: style.referenceStrokeWidthPx.coastline * scale
			};
			for (const feature of basemap.land.features) {
				renderer.path(feature.geometry, coastlineStyle);
			}
		}

		// 8. Admin borders — admin1 under admin0, both dashed, admin0 heavier.
		if (overlay.showAdmin1) {
			const admin1Style: PathStyle = {
				stroke: style.admin1Stroke,
				strokeWidthPx: style.referenceStrokeWidthPx.admin1 * scale,
				dashPx: [2 * scale, 3 * scale]
			};
			for (const feature of basemap.admin1.features) renderer.path(feature.geometry, admin1Style);
		}

		const admin0Style: PathStyle = {
			stroke: style.admin0Stroke,
			strokeWidthPx: style.referenceStrokeWidthPx.admin0 * scale,
			dashPx: [4 * scale, 3 * scale]
		};
		for (const feature of basemap.admin0.features) renderer.path(feature.geometry, admin0Style);
		return;
	}

	if (phase === 'tracks') {
		// 9-10. Tracks, drawn as two full passes — casing under, color over —
		// so a wide casing never cuts across a neighbouring track drawn after it.
		const visibleTracks = tracks.filter((t) => t.style.visible);
		const casingWidthPx = style.referenceStrokeWidthPx.trackCasingExtra * scale;
		for (const track of visibleTracks) {
			renderer.path(trackToGeoJSON(track).geometry, {
				stroke: style.trackCasing,
				strokeWidthPx: track.style.widthPx * scale + casingWidthPx,
				opacity: track.style.opacity
			});
		}
		for (const track of visibleTracks) {
			renderer.path(trackToGeoJSON(track).geometry, {
				stroke: track.style.color,
				strokeWidthPx: track.style.widthPx * scale,
				opacity: track.style.opacity
			});
		}
		return;
	}

	// overlay. mapTop bounds the map's own drawable area within the canvas —
	// narrower than [0, outputHeight] only at the top, when a title band
	// and/or a description band is reserved above it (see buildSceneInput.ts,
	// which grows outputHeight and shifts `projection` down by the same
	// amount so the two stay in lockstep). The description band sits
	// directly below the title band (or at the very top if there's no
	// title), so it's guaranteed never to overlap the track. Nothing is
	// reserved below the map: stats, scale bar and credit draw directly over
	// the map's own bottom margin, each with its own neutral background
	// sized to its text.
	const titleBandPx = overlay.title ? titleBandHeightPx(style) * scale : 0;
	const descriptionBandPx = overlay.description ? descriptionBandHeightPx(style) * scale : 0;
	const mapTop = titleBandPx + descriptionBandPx;
	const mapBottom = input.outputHeight;

	drawPlaces(renderer, input, scale, mapTop, mapBottom);
	drawBottomLeft(renderer, input, scale, mapBottom);
	drawCredit(renderer, input, scale, mapBottom);
	drawTitleBand(renderer, input, scale, titleBandPx);
	drawDescriptionBand(renderer, input, scale, titleBandPx, descriptionBandPx);
}

/** Keeps features whose min_zoom (if any) has been reached at this framing's zoom. */
function filterByZoom(fc: GeoJSON.FeatureCollection, zoom: number, bias: DetailBias): GeoJSON.Feature[] {
	return fc.features.filter((f) => visibleAt(f.properties?.min_zoom as number | undefined, zoom, bias));
}

/** Linear interpolation across a place's size, 0 (largest) to CITY_SIZE_MAX (smallest). */
function sizeLerp(size: number, largest: number, smallest: number): number {
	const t = Math.min(1, Math.max(0, size / CITY_SIZE_MAX));
	return largest + (smallest - largest) * t;
}

function drawPlaces(
	renderer: Renderer,
	input: SceneInput,
	scale: number,
	mapTop: number,
	mapBottom: number
): void {
	const { basemap, overlay, style, projection, measureTextWidth, outputWidth } = input;
	const dotRadii = style.referenceCityDotRadiusPx;
	const fontSizes = style.referenceFontSizePx;

	interface Positioned {
		id: string;
		xy: [number, number];
		radiusPx: number;
	}
	const candidates: LabelCandidate[] = [];
	const positioned: Positioned[] = [];

	(basemap.places.features as GeoJSON.Feature<GeoJSON.Point, PlaceProperties>[]).forEach((feature, i) => {
		const { size, rank } = feature.properties;
		if (size > overlay.citySize) return;
		const xy = projection(feature.geometry.coordinates as [number, number]);
		if (!xy) return;
		const [x, y] = xy;
		if (x < 0 || y < mapTop || x > outputWidth || y > mapBottom) return;

		const id = `place-${i}`;
		const radiusPx = sizeLerp(size, dotRadii.largest, dotRadii.smallest) * scale;
		positioned.push({ id, xy, radiusPx });

		const fontSizePx = sizeLerp(size, fontSizes.cityLargest, fontSizes.citySmallest) * scale;
		const text = feature.properties.names?.[overlay.cityLabelLanguage] ?? feature.properties.name;
		candidates.push({ id, xy, text, priority: size * 100 + rank, fontSizePx });
	});

	for (const p of positioned) {
		renderer.circle(p.xy, p.radiusPx, { fill: style.cityDotFill });
	}

	const placed = placeLabels(
		candidates,
		(text, fontSizePx) => measureTextWidth(text, { sizePx: fontSizePx, family: style.fontFamily }),
		outputWidth,
		mapBottom
	);
	for (const label of placed) {
		const font: Font = { sizePx: label.fontSizePx, family: style.fontFamily };
		renderer.text(label.textXy, label.text, {
			font,
			fill: style.textColor,
			anchor: 'start',
			haloColor: style.textHalo,
			haloWidthPx: label.fontSizePx * 0.15
		});
	}
}

/**
 * Stacks the scale bar (bottom) and stats text (above it) in the bottom-left
 * corner of the map, bottom-up, so the two never collide — both would
 * otherwise anchor to the same `mapBottom - marginPx` baseline.
 */
function drawBottomLeft(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
	const { overlay, style, outputWidth, marginPx, projection } = input;
	let y = mapBottom - marginPx;

	if (overlay.showScaleBar) {
		const bar = computeScaleBar(projection, outputWidth, mapBottom, marginPx);
		if (bar) {
			const barHeightPx = 3 * scale;
			renderer.rect(marginPx, y - barHeightPx, bar.widthPx, barHeightPx, { fill: style.scaleBarColor });

			const font: Font = { sizePx: style.referenceFontSizePx.scaleBar * scale, family: style.fontFamily };
			renderer.text([marginPx, y - barHeightPx - font.sizePx * 0.6], bar.label, {
				font,
				fill: style.textColor,
				anchor: 'start',
				haloColor: style.textHalo,
				haloWidthPx: font.sizePx * 0.15
			});
			y -= barHeightPx + font.sizePx * 1.6;
		}
	}

	if (overlay.statsText) {
		const font: Font = { sizePx: style.referenceFontSizePx.stats * scale, family: style.fontFamily };
		renderer.text([marginPx, y], overlay.statsText, {
			font,
			fill: style.textColor,
			anchor: 'start',
			haloColor: style.textHalo,
			haloWidthPx: font.sizePx * 0.15
		});
	}
}

/** Credit sits bottom-right of the map, matching drawBottomLeft's corner. */
function drawCredit(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
	const { overlay, style, outputWidth, marginPx, basemap } = input;
	if (!overlay.showCredit) return;

	const font: Font = { sizePx: style.referenceFontSizePx.credit * scale, family: style.fontFamily };
	renderer.text([outputWidth - marginPx, mapBottom - marginPx], basemap.attribution, {
		font,
		fill: style.textColor,
		anchor: 'end',
		haloColor: style.textHalo,
		haloWidthPx: font.sizePx * 0.15
	});
}

/**
 * Draws `text` with a neutral background rectangle fit to the text itself
 * (plus a little padding) rather than the full row — the "neutral colour
 * behind overlay text" requirement, scoped to just the text so it doesn't
 * read as a strip painted across the whole image. Used for the title and
 * description, which are prominent enough to warrant a solid backing plate;
 * the smaller stats/scale-bar/credit text uses a per-glyph halo instead
 * (see their `haloColor`/`haloWidthPx`), since a filled box there would
 * cover more of the map than three short lines need.
 */
function drawLabelWithBackground(
	renderer: Renderer,
	input: SceneInput,
	xy: [number, number],
	text: string,
	font: Font,
	anchor: 'start' | 'middle' | 'end'
): void {
	const { style, measureTextWidth } = input;
	const textWidthPx = measureTextWidth(text, font);
	const paddingXPx = font.sizePx * 0.5;
	const boxWidthPx = textWidthPx + paddingXPx * 2;
	const boxHeightPx = font.sizePx * TEXT_BAND_LINE_HEIGHT;
	const left =
		anchor === 'middle'
			? xy[0] - boxWidthPx / 2
			: anchor === 'end'
				? xy[0] - textWidthPx - paddingXPx
				: xy[0] - paddingXPx;

	renderer.rect(left, xy[1] - boxHeightPx / 2, boxWidthPx, boxHeightPx, { fill: style.textHalo });
	renderer.text(xy, text, { font, fill: style.textColor, anchor });
}

/**
 * The title lives in its own band above the map — `buildSceneInput.ts`
 * grows `outputHeight` by exactly `titleBandPx` and shifts `projection`
 * down by the same amount, so this band is genuinely empty map-wise. Its
 * background box (see `drawLabelWithBackground`) exactly fills that band's
 * height, since both are derived from the same `TEXT_BAND_LINE_HEIGHT`.
 */
function drawTitleBand(renderer: Renderer, input: SceneInput, scale: number, titleBandPx: number): void {
	const { overlay, style, outputWidth } = input;
	if (!overlay.title || titleBandPx <= 0) return;

	const font: Font = { sizePx: style.referenceFontSizePx.title * scale, family: style.fontFamily, weight: 'bold' };
	drawLabelWithBackground(renderer, input, [outputWidth / 2, titleBandPx / 2], overlay.title, font, 'middle');
}

/**
 * The description lives in its own band directly below the title band (or
 * at the very top of the canvas if there's no title) — `buildSceneInput.ts`
 * grows `outputHeight` by exactly `descriptionBandPx`, on top of any title
 * band, and shifts `projection` down by the combined amount, so this band
 * is genuinely empty map-wise and the description can never overlap the
 * track.
 */
function drawDescriptionBand(
	renderer: Renderer,
	input: SceneInput,
	scale: number,
	titleBandPx: number,
	descriptionBandPx: number
): void {
	const { overlay, style, outputWidth } = input;
	if (!overlay.description || descriptionBandPx <= 0) return;

	const font: Font = { sizePx: style.referenceFontSizePx.stats * scale, family: style.fontFamily };
	drawLabelWithBackground(
		renderer,
		input,
		[outputWidth / 2, titleBandPx + descriptionBandPx / 2],
		overlay.description,
		font,
		'middle'
	);
}
