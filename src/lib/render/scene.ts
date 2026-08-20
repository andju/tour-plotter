import type { GeoProjection } from 'd3-geo';
import type { PlaceCapital } from '../basemap/placeCapital';
import type { BasemapLayers, PlaceProperties } from '../basemap/types';
import { bboxIntersects, featureBbox } from './cull';
import type { Bbox } from '../geo/bbox';
import { trackToGeoJSON, type Track } from '../gpx/types';
import { visibleAt, zoomForProjection, type DetailBias } from './detail';
import { placeLabels, type LabelCandidate } from './labels';
import { parseRichText } from './markdown';
import { buildInsetProjection, minimapBbox, minimapBox, minimapHeightPx, minimapMarker } from './minimap';
import { placeSymbol, type PlaceSymbol } from './placeSymbol';
import { layoutRichText, TEXT_BAND_LINE_HEIGHT } from './richTextLayout';
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
	/** "You are here" marker on the minimap — a fixed Material Design red so it reads against every palette, not derived from textColor. */
	minimapMarkerColor: string;
	trackCasing: string;
	scaleBarColor: string;
	fontFamily: string;
	/** Used for inline `` `code` `` runs in the title (see richTextLayout.ts). No system font stack is loaded for this beyond the browser/OS default monospace face. */
	monoFontFamily: string;
	referenceStrokeWidthPx: {
		coastline: number;
		water: number;
		waterway: number;
		admin0: number;
		admin1: number;
		trackCasingExtra: number;
	};
	/** Marker half-extent (circle radius / square half-side / star circumradius base) per size class — see basemap/placeSize.ts's `sizeClass` and render/placeSymbol.ts. Index 0 is the largest class; discrete, not a taper, since readers can only reliably tell a handful of point sizes apart. */
	referenceCitySymbolRadiusPx: number[];
	referenceFontSizePx: {
		/** City label font size per size class, same indexing as referenceCitySymbolRadiusPx. */
		cityTiers: number[];
		title: number;
		stats: number;
		credit: number;
		scaleBar: number;
	};
	referenceMinimapPx: {
		/** The inset's width; its height follows the framed extent's own aspect ratio (see minimap.ts's projectedAspect). */
		width: number;
		innerMarginPx: number;
		frameStroke: number;
		landStroke: number;
		adminStroke: number;
		markerStroke: number;
		/** Below this, the projected viewport is drawn as a dot instead of an outlined rect. */
		markerMinSizePx: number;
		markerDotRadius: number;
	};
}

/**
 * Where an overlay panel (the title pill, the minimap) anchors, as a
 * corner/edge of the canvas. Shared between the two rather than each having
 * its own type, since the anchor arithmetic (see drawTitle/drawMinimap) is
 * identical.
 */
export type OverlayPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface OverlaySettings {
	title: string | null;
	titlePosition: OverlayPosition;
	statsText: string | null;
	showAdmin1: boolean;
	showCredit: boolean;
	showScaleBar: boolean;
	detailBias: DetailBias;
	/** City-label language code (see basemap/languages.ts); falls back to each place's default name when unsupported by the source. */
	cityLabelLanguage: string;
	/** City-size slider value (0-CITY_SIZE_MAX), independent of detailBias — see basemap/placeSize.ts. */
	citySize: number;
	showMinimap: boolean;
	minimapPosition: OverlayPosition;
	/** Radius (in km) the minimap frames around the tour, before the ±84° latitude clamp — see minimap.ts's minimapBbox. */
	minimapCoverageKm: number;
}

export interface SceneInput {
	outputWidth: number;
	outputHeight: number;
	marginPx: number;
	projection: GeoProjection;
	/**
	 * The full geographic extent visible on the canvas (see `Framing.visibleBbox`
	 * in buildSceneInput.ts) — used to viewport-cull basemap features before
	 * they reach `geoPath`, since none of the basemap sources filter by
	 * bbox themselves (Natural Earth ships the whole planet; an OSM tile
	 * cover is fetched by bbox but still has slack past its edges).
	 */
	visibleBbox: Bbox;
	basemap: BasemapLayers;
	/** Already filtered to the visible subset by the caller. */
	tracks: Track[];
	overlay: OverlaySettings;
	style: SceneStyle;
	measureTextWidth: (value: string, font: Font) => number;
	/**
	 * Coarse world land/water, source-independent (unlike `basemap`, which is
	 * per-source) — backs the minimap inset, which needs land outlines even
	 * in OSM mode, where `basemap.land` is null. Null until the minimap is
	 * first enabled (see worldLand.ts) or when it's off entirely.
	 */
	worldLand: GeoJSON.FeatureCollection | null;
	/**
	 * Coarse world admin0 borders, the minimap's counterpart to `worldLand` —
	 * same source-independence rationale (OSM tiles carry no admin0 layer),
	 * same null-until-loaded/off lifecycle. See worldAdmin0.ts.
	 */
	worldAdmin0: GeoJSON.FeatureCollection | null;
}

/**
 * The ordered groups `composeScene` draws in. Split out so the preview can
 * cache the phases a per-track style edit (colour/width/opacity) never
 * touches — `basemap`, `overlay` and `minimap` — as separate bitmaps, and
 * re-run only `tracks` on a slider tick. See `layerCache.ts`. `minimap` is
 * its own phase (not folded into `overlay`) because it's driven by an
 * entirely different set of settings (position/coverage, not city
 * size/language) — keying one bitmap on the union of both would bust it on
 * changes that don't affect it. `text` (the title pill) is split out for the
 * same reason but goes further: the preview draws it on its own stacked
 * canvas, live, on every keystroke, because unlike `overlay`/`minimap` (city
 * label placement, a second projection — both expensive) it's cheap enough
 * not to need caching at all. See PreviewCanvas.svelte. `minimap` is drawn
 * above `overlay` (city labels) so its opaque panel occludes them, and below
 * `text` so the title stays on top of everything.
 */
export type ScenePhase = 'basemap' | 'tracks' | 'overlay' | 'minimap' | 'text';
export const SCENE_PHASES: readonly ScenePhase[] = ['basemap', 'tracks', 'overlay', 'minimap', 'text'];

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
	const { outputWidth, projection, basemap, tracks, overlay, style, visibleBbox } = input;
	const scale = outputWidth / 1000;
	const zoom = zoomForProjection(projection);
	const bias = overlay.detailBias;

	if (phase === 'basemap') {
		// 1. Background. OSM tiles carry no land polygon (ocean arrives as a
		// `water` feature), so the page itself starts as land; Natural Earth
		// carries an explicit land polygon over an implicit ocean, so the page
		// starts as water and land is painted on top at step 2.
		renderer.rect(0, 0, input.outputWidth, input.outputHeight, { fill: backgroundFillFor(basemap, style) });

		// Natural Earth ships the whole planet with no bbox split, and none
		// of the basemap sources filter by viewport themselves (an OSM tile
		// cover is fetched by bbox but still has slack past its edges), so
		// every layer is viewport-culled here before it reaches geoPath.
		// Land is filtered once and reused for both the fill (step 2) and
		// the coastline stroke (step 7) below, rather than twice.
		const land = basemap.land ? visibleFeatures(basemap.land, zoom, bias, visibleBbox) : null;

		// 2. Land (Natural Earth only), fill only — the coastline is stroked
		// separately at step 7, after water, so it reads as a crisp line on top
		// rather than blending into the fill's own edge.
		if (land) {
			for (const feature of land) {
				renderer.path(feature.geometry, { fill: style.landFill });
			}
		}

		// 3. Urban / landcover fills.
		for (const feature of visibleFeatures(basemap.urban, zoom, bias, visibleBbox)) {
			renderer.path(feature.geometry, { fill: style.urbanFill });
		}

		// 4. Parks.
		for (const feature of visibleFeatures(basemap.parks, zoom, bias, visibleBbox)) {
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
		for (const feature of visibleFeatures(basemap.water, zoom, bias, visibleBbox)) {
			renderer.path(feature.geometry, waterStyle);
		}

		// 6. Waterway strokes — opaque, so tile-buffer overlap between adjacent
		// tiles (invisible for opaque strokes) doesn't need the same seam
		// avoidance as filled polygons.
		const waterwayStyle: PathStyle = {
			stroke: style.waterwayStroke,
			strokeWidthPx: style.referenceStrokeWidthPx.waterway * scale
		};
		for (const feature of visibleFeatures(basemap.waterways, zoom, bias, visibleBbox)) {
			renderer.path(feature.geometry, waterwayStyle);
		}

		// 7. Coastline (Natural Earth only) — land's own outline, stroked now
		// that water has been painted, so it reads as a crisp line on top.
		if (land) {
			const coastlineStyle: PathStyle = {
				stroke: style.coastlineStroke,
				strokeWidthPx: style.referenceStrokeWidthPx.coastline * scale
			};
			for (const feature of land) {
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
			for (const feature of visibleFeatures(basemap.admin1, zoom, bias, visibleBbox)) {
				renderer.path(feature.geometry, admin1Style);
			}
		}

		const admin0Style: PathStyle = {
			stroke: style.admin0Stroke,
			strokeWidthPx: style.referenceStrokeWidthPx.admin0 * scale
		};
		for (const feature of visibleFeatures(basemap.admin0, zoom, bias, visibleBbox)) {
			renderer.path(feature.geometry, admin0Style);
		}
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

	if (phase === 'minimap') {
		drawMinimap(renderer, input, scale);
		return;
	}

	if (phase === 'text') {
		// Draws only the title pill (see drawLabelWithBackground), positioned
		// per overlay.titlePosition directly over the map — nothing reserves
		// space for it, so it sits on top of whatever basemap/track content
		// is already there, same as the credit/stats corner text below.
		drawTitle(renderer, input, scale);
		return;
	}

	// overlay.
	const mapBottom = input.outputHeight;

	drawPlaces(renderer, input, scale, mapBottom);
	drawBottomLeft(renderer, input, scale, mapBottom);
	drawCredit(renderer, input, scale, mapBottom);
}

/**
 * The 'basemap' phase's own background fill decision, exported so
 * PreviewCanvas.svelte's preview-only band-background compensation (see the
 * 'text' phase's doc comment above) paints the exact same colour rather than
 * restating the land/water choice.
 */
export function backgroundFillFor(basemap: BasemapLayers, style: SceneStyle): string {
	return basemap.baseFill === 'land' ? style.landFill : style.backgroundFill;
}

/**
 * Keeps features whose min_zoom (if any) has been reached at this framing's
 * zoom, and whose own bbox overlaps the framing's visible extent. The bbox
 * test is what keeps a full-planet Natural Earth layer, or an OSM tile
 * cover's slack past its requested bbox, from being handed to geoPath in
 * full on every render — see cull.ts's featureBbox/bboxIntersects.
 */
function visibleFeatures(
	fc: GeoJSON.FeatureCollection,
	zoom: number,
	bias: DetailBias,
	visibleBbox: Bbox
): GeoJSON.Feature[] {
	return fc.features.filter(
		(f) =>
			visibleAt(f.properties?.min_zoom as number | undefined, zoom, bias) &&
			bboxIntersects(featureBbox(f), visibleBbox)
	);
}

/**
 * Draws one place's symbol: a plain circle, a square for a first-order
 * capital, or a star for a national capital — see placeSymbol.ts.
 */
function drawSymbol(renderer: Renderer, xy: [number, number], symbol: PlaceSymbol, style: SceneStyle): void {
	if (symbol.shape === 'circle') {
		renderer.circle(xy, symbol.drawRadiusPx, { fill: style.cityDotFill });
		return;
	}
	if (symbol.shape === 'square') {
		const h = symbol.drawRadiusPx;
		renderer.rect(xy[0] - h, xy[1] - h, h * 2, h * 2, { fill: style.cityDotFill });
		return;
	}
	renderer.polygon(symbol.starPoints, { fill: style.cityDotFill });
}

/** A capital's label is worth keeping over a merely-larger neighbour it competes with for space — see placeLabels' priority (lower wins). Bumped by less than one size class (~200 priority points), so a capital never outranks a genuinely larger ordinary place two classes up. */
function capitalPriorityBoost(capital: PlaceCapital | undefined): number {
	if (capital === 'country') return 100;
	if (capital === 'region') return 50;
	return 0;
}

function drawPlaces(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
	const { basemap, overlay, style, projection, measureTextWidth, outputWidth } = input;
	const radiiPx = style.referenceCitySymbolRadiusPx.map((r) => r * scale);
	const fontSizesPx = style.referenceFontSizePx.cityTiers.map((f) => f * scale);

	interface Positioned {
		xy: [number, number];
		symbol: PlaceSymbol;
	}
	const candidates: LabelCandidate[] = [];
	const positioned: Positioned[] = [];

	(basemap.places.features as GeoJSON.Feature<GeoJSON.Point, PlaceProperties>[]).forEach((feature, i) => {
		const { size, rank, capital } = feature.properties;
		if (size > overlay.citySize) return;
		const xy = projection(feature.geometry.coordinates as [number, number]);
		if (!xy) return;
		const [x, y] = xy;
		if (x < 0 || y < 0 || x > outputWidth || y > mapBottom) return;

		const symbol = placeSymbol(xy, size, capital, radiiPx, fontSizesPx);
		positioned.push({ xy, symbol });

		const id = `place-${i}`;
		const text = feature.properties.names?.[overlay.cityLabelLanguage] ?? feature.properties.name;
		candidates.push({
			id,
			xy,
			text,
			priority: size * 100 + rank - capitalPriorityBoost(capital),
			fontSizePx: symbol.fontSizePx,
			anchorRadiusPx: symbol.anchorRadiusPx
		});
	});

	// Smallest first, largest last, so a prominent symbol always sits on top where two overlap.
	positioned.sort((a, b) => a.symbol.anchorRadiusPx - b.symbol.anchorRadiusPx);
	for (const { xy, symbol } of positioned) {
		drawSymbol(renderer, xy, symbol, style);
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
 * Gap (at the 1000px reference width) between the scale bar's own bar and
 * label inside their shared pill, and again between that pill and the stats
 * pill stacked above it — reused for both so the two visually separate
 * chips never crowd together.
 */
const BOTTOM_LEFT_STACK_GAP_PX = 6;

/**
 * Height the scale bar's pill (bar + label, plus the same padding/plate
 * treatment as the title — see `drawTitle`) occupies above `mapBottom -
 * marginPx`, mirroring the arithmetic `drawBottomLeft` uses to step `y` up
 * past it — shared by both so they can't drift apart. 0 when the bar is off
 * or `computeScaleBar` has nothing to show (e.g. an unprojectable view).
 */
function scaleBarStackHeightPx(input: SceneInput, scale: number, mapBottom: number): number {
	const { overlay, style, outputWidth, marginPx, projection } = input;
	if (!overlay.showScaleBar) return 0;
	const bar = computeScaleBar(projection, outputWidth, mapBottom, marginPx);
	if (!bar) return 0;
	const barHeightPx = 3 * scale;
	const labelFontSizePx = style.referenceFontSizePx.scaleBar * scale;
	const paddingPx = labelFontSizePx * 0.5;
	const labelHeightPx = labelFontSizePx * TEXT_BAND_LINE_HEIGHT;
	return paddingPx * 2 + labelHeightPx + BOTTOM_LEFT_STACK_GAP_PX * scale + barHeightPx;
}

/**
 * Total height the scale-bar+stats stack occupies above `mapBottom -
 * marginPx` — used to reserve space for it against another corner-anchored
 * overlay landing on bottom-left (see `fixedCornerReservedHeightPx`). 0 when
 * neither is drawn.
 */
function bottomLeftStackHeightPx(input: SceneInput, scale: number, mapBottom: number): number {
	const scaleBarHeight = scaleBarStackHeightPx(input, scale, mapBottom);
	let height = scaleBarHeight;
	if (input.overlay.statsText) {
		if (height > 0) height += BOTTOM_LEFT_STACK_GAP_PX * scale;
		const fontSizePx = input.style.referenceFontSizePx.stats * scale;
		height += fontSizePx * TEXT_BAND_LINE_HEIGHT;
	}
	return height;
}

/**
 * Stacks the scale bar (bottom) and stats text (above it) in the bottom-left
 * corner of the map, bottom-up, so the two never collide — both would
 * otherwise anchor to the same `mapBottom - marginPx` baseline. Each sits on
 * its own background pill, matching the title's (see `drawTitle`): same
 * translucent `style.textHalo` plate, same horizontal-only padding bled past
 * the margin rather than inset from it.
 */
function drawBottomLeft(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
	const { overlay, style, measureTextWidth, outputWidth, marginPx, projection } = input;
	const pillFill = hexToRgba(style.textHalo, 0.8);
	let y = mapBottom - marginPx;

	if (overlay.showScaleBar) {
		const bar = computeScaleBar(projection, outputWidth, mapBottom, marginPx);
		if (bar) {
			const barHeightPx = 3 * scale;
			const labelFont: Font = { sizePx: style.referenceFontSizePx.scaleBar * scale, family: style.fontFamily };
			const paddingPx = labelFont.sizePx * 0.5;
			const labelWidthPx = measureTextWidth(bar.label, labelFont);
			const labelHeightPx = labelFont.sizePx * TEXT_BAND_LINE_HEIGHT;
			const boxWidthPx = Math.max(bar.widthPx, labelWidthPx) + paddingPx * 2;
			const boxHeightPx = paddingPx * 2 + labelHeightPx + BOTTOM_LEFT_STACK_GAP_PX * scale + barHeightPx;
			const boxTop = y - boxHeightPx;
			renderer.rect(marginPx - paddingPx, boxTop, boxWidthPx, boxHeightPx, { fill: pillFill });

			renderer.text([marginPx, boxTop + paddingPx + labelHeightPx / 2], bar.label, {
				font: labelFont,
				fill: style.textColor,
				anchor: 'start'
			});
			renderer.rect(marginPx, y - paddingPx - barHeightPx, bar.widthPx, barHeightPx, { fill: style.scaleBarColor });

			y = boxTop - BOTTOM_LEFT_STACK_GAP_PX * scale;
		}
	}

	if (overlay.statsText) {
		const font: Font = { sizePx: style.referenceFontSizePx.stats * scale, family: style.fontFamily };
		const paddingPx = font.sizePx * 0.5;
		const textWidthPx = measureTextWidth(overlay.statsText, font);
		const boxWidthPx = textWidthPx + paddingPx * 2;
		const boxHeightPx = font.sizePx * TEXT_BAND_LINE_HEIGHT;
		const boxTop = y - boxHeightPx;
		renderer.rect(marginPx - paddingPx, boxTop, boxWidthPx, boxHeightPx, { fill: pillFill });

		renderer.text([marginPx, boxTop + boxHeightPx / 2], overlay.statsText, {
			font,
			fill: style.textColor,
			anchor: 'start'
		});
	}
}

/** Line height to reserve for the credit's pill above `mapBottom - marginPx`. 0 when the credit is off. */
function creditHeightPx(input: SceneInput, scale: number): number {
	if (!input.overlay.showCredit) return 0;
	return input.style.referenceFontSizePx.credit * scale * TEXT_BAND_LINE_HEIGHT;
}

/**
 * Credit sits bottom-right of the map, matching drawBottomLeft's corner, on
 * the same background pill treatment as the title and the bottom-left stack.
 */
function drawCredit(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
	const { overlay, style, measureTextWidth, outputWidth, marginPx, basemap } = input;
	if (!overlay.showCredit) return;

	const font: Font = { sizePx: style.referenceFontSizePx.credit * scale, family: style.fontFamily };
	const paddingPx = font.sizePx * 0.5;
	const textWidthPx = measureTextWidth(basemap.attribution, font);
	const boxWidthPx = textWidthPx + paddingPx * 2;
	const boxHeightPx = font.sizePx * TEXT_BAND_LINE_HEIGHT;
	const boxTop = mapBottom - marginPx - boxHeightPx;
	const boxRight = outputWidth - marginPx + paddingPx;

	renderer.rect(boxRight - boxWidthPx, boxTop, boxWidthPx, boxHeightPx, { fill: hexToRgba(style.textHalo, 0.8) });
	renderer.text([outputWidth - marginPx, boxTop + boxHeightPx / 2], basemap.attribution, {
		font,
		fill: style.textColor,
		anchor: 'end'
	});
}

/**
 * Height already claimed at `position` by the fixed-corner elements (the
 * scale-bar+stats stack at bottom-left, the credit at bottom-right) — both
 * drawn in the `'overlay'` phase, before any corner-anchored overlay that
 * queries this (minimap, title; see `SCENE_PHASES`). Each non-zero
 * contribution is padded by `BOTTOM_LEFT_STACK_GAP_PX` — the same gap
 * `drawBottomLeft` uses between its own stacked stats/scale-bar pills — so
 * every stacked pair of overlay pills reads with one consistent gap. 0 for
 * any other position, since neither fixed element sits anywhere else.
 */
function fixedCornerReservedHeightPx(position: OverlayPosition, input: SceneInput, scale: number, mapBottom: number): number {
	const gapPx = BOTTOM_LEFT_STACK_GAP_PX * scale;
	if (position === 'bottom-left') {
		const h = bottomLeftStackHeightPx(input, scale, mapBottom);
		return h > 0 ? h + gapPx : 0;
	}
	if (position === 'bottom-right') {
		const h = creditHeightPx(input, scale);
		return h > 0 ? h + gapPx : 0;
	}
	return 0;
}

/**
 * The title floats directly over the map, anchored to the corner/edge
 * `overlay.titlePosition` picks — nothing reserves space for it, so it sits
 * on top of whatever basemap/track content is already there. `marginPx` is
 * already in output-pixel space (see `drawBottomLeft`/`drawCredit`, which
 * use it the same way), unlike `font.sizePx` which is derived from the
 * 1000px-reference `style` and scaled here.
 *
 * `overlay.title` is parsed as a text-only markdown subset (see markdown.ts)
 * and laid out as a stack of styled runs (richTextLayout.ts), then drawn
 * behind one neutral background rectangle fit to the block as a whole (the
 * widest line's width, the full stack's height) rather than the full row —
 * the "neutral colour behind overlay text" requirement, scoped to just the
 * text so it doesn't read as a strip painted across the whole image. The
 * scale bar, stats, and credit (`drawBottomLeft`/`drawCredit`) use the same
 * `hexToRgba(style.textHalo, 0.8)` plate, sized the same way — horizontal
 * padding only, bled past the margin rather than inset from it — so all four
 * overlay elements read as one consistent pill treatment.
 *
 * Each run is drawn with an explicit `start` anchor at a precomputed x, even
 * for a `middle`/`end`-anchored title — Renderer.text's own anchor modes
 * can't chain multiple runs across one line (each run's x depends on the
 * width of every run before it), so this resolves alignment itself instead.
 */
/** Converts a `#rrggbb` color to `rgba(...)` at the given alpha, for the overlay pills' translucent background plate — the only spot `style.textHalo` needs partial opacity (its other use, city/place labels, is an opaque per-glyph halo). */
function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawTitle(renderer: Renderer, input: SceneInput, scale: number): void {
	const { overlay, style, measureTextWidth, outputWidth, outputHeight, marginPx } = input;
	if (!overlay.title) return;

	const baseFontSizePx = style.referenceFontSizePx.title * scale;
	const block = layoutRichText(
		parseRichText(overlay.title),
		{ baseFontSizePx, fontFamily: style.fontFamily, monoFontFamily: style.monoFontFamily },
		measureTextWidth
	);
	if (block.lines.length === 0) return;

	const paddingXPx = baseFontSizePx * 0.5;
	const boxWidthPx = block.widthPx + paddingXPx * 2;
	const boxHeightPx = block.heightPx;

	// The title is drawn last (see SCENE_PHASES), so it reserves space
	// against everything already painted at its corner: the fixed
	// scale-bar+stats/credit, plus the minimap if it happens to share the
	// same position — otherwise the title's background plate would sit on
	// top of (and hide part of) either.
	let reservedPx = fixedCornerReservedHeightPx(overlay.titlePosition, input, scale, outputHeight);
	const minimap = minimapDimensionsPx(input, scale);
	if (minimap && overlay.minimapPosition === overlay.titlePosition) {
		reservedPx += minimap.heightPx + BOTTOM_LEFT_STACK_GAP_PX * scale;
	}

	const isTop = overlay.titlePosition.startsWith('top');
	const boxTop = isTop ? marginPx + reservedPx : outputHeight - marginPx - boxHeightPx - reservedPx;

	const anchor: 'start' | 'middle' | 'end' = overlay.titlePosition.endsWith('left')
		? 'start'
		: overlay.titlePosition.endsWith('right')
			? 'end'
			: 'middle';
	// Mirrors the pre-markdown single-line layout: the anchor point sits at
	// the margin (or canvas centre), and the padding-plus-text box is built
	// out from it — for 'start'/'end' this lets the box bleed slightly past
	// the margin by `paddingXPx` rather than the text itself sitting inset.
	const anchorXPx = anchor === 'start' ? marginPx : anchor === 'end' ? outputWidth - marginPx : outputWidth / 2;
	const boxLeft =
		anchor === 'start'
			? anchorXPx - paddingXPx
			: anchor === 'end'
				? anchorXPx + paddingXPx - boxWidthPx
				: anchorXPx - boxWidthPx / 2;

	renderer.rect(boxLeft, boxTop, boxWidthPx, boxHeightPx, { fill: hexToRgba(style.textHalo, 0.8) });

	for (const line of block.lines) {
		if (line.runs.length === 0) continue;
		const lineLeft =
			anchor === 'start'
				? boxLeft + paddingXPx
				: anchor === 'end'
					? boxLeft + boxWidthPx - paddingXPx - line.widthPx
					: boxLeft + boxWidthPx / 2 - line.widthPx / 2;
		const lineCenterY = boxTop + line.centerYPx;

		for (const run of line.runs) {
			const runX = lineLeft + run.xPx;
			renderer.text([runX, lineCenterY], run.text, { font: run.font, fill: style.textColor, anchor: 'start' });
			if (run.strike) {
				const strikeHeightPx = Math.max(1, run.font.sizePx * 0.07);
				renderer.rect(runX, lineCenterY - strikeHeightPx / 2, run.widthPx, strikeHeightPx, { fill: style.textColor });
			}
		}
	}
}

/**
 * The minimap's own size and framing bbox, or `null` when it isn't showing
 * (off, or `worldLand` not yet loaded) — split out from `drawMinimap` so
 * another corner-anchored overlay (currently just the title) can reserve
 * space against it without duplicating this computation or rendering
 * anything itself.
 */
function minimapDimensionsPx(input: SceneInput, scale: number): { widthPx: number; heightPx: number; bbox: Bbox } | null {
	const { overlay, style, worldLand, visibleBbox: mapVisibleBbox } = input;
	if (!overlay.showMinimap || !worldLand) return null;

	const widthPx = style.referenceMinimapPx.width * scale;
	const bbox = minimapBbox(mapVisibleBbox, overlay.minimapCoverageKm);
	return { widthPx, heightPx: minimapHeightPx(bbox, widthPx), bbox };
}

/**
 * The minimap: an opaque panel anchored to `overlay.minimapPosition` (same
 * corner/edge vocabulary as the title), showing coarse world land at a much
 * larger extent than the main map, plus a marker for where the main map's
 * own visible extent falls inside it. Drawn from `worldLand` — source-
 * independent coarse data — rather than `basemap`, since OSM mode's
 * `basemap.land` is null and the inset needs land outlines either way.
 * Returns early with no `worldLand` (not yet loaded, or the minimap is off)
 * rather than drawing an empty panel.
 *
 * Drawn after the scale bar/stats/credit (the `'overlay'` phase runs first —
 * see `SCENE_PHASES`), so if `overlay.minimapPosition` lands on one of their
 * corners the panel would otherwise paint straight over them; `reservedPx`
 * (via `fixedCornerReservedHeightPx`) pushes the panel's anchored edge in
 * past them instead.
 */
function drawMinimap(renderer: Renderer, input: SceneInput, scale: number): void {
	const { overlay, style, worldLand, worldAdmin0, outputWidth, outputHeight, marginPx, visibleBbox: mapVisibleBbox } = input;
	const dimensions = minimapDimensionsPx(input, scale);
	if (!dimensions || !worldLand) return;
	const { widthPx, bbox } = dimensions;

	const sizes = style.referenceMinimapPx;
	const innerMarginPx = sizes.innerMarginPx * scale;

	const reservedPx = fixedCornerReservedHeightPx(overlay.minimapPosition, input, scale, outputHeight);
	const box = minimapBox(overlay.minimapPosition, outputWidth, outputHeight, marginPx, widthPx, bbox, reservedPx);

	// Panel background first (stands in for water — this app's coarse land
	// data has no matching water polygon), then land clipped to the box.
	renderer.rect(box.x, box.y, box.w, box.h, { fill: style.backgroundFill });

	const insetProjection = buildInsetProjection(box, bbox, innerMarginPx);
	const insetRenderer = renderer.withProjection(insetProjection);
	const landStyle: PathStyle = {
		fill: style.landFill,
		stroke: style.coastlineStroke,
		strokeWidthPx: sizes.landStroke * scale
	};
	for (const feature of worldLand.features) {
		insetRenderer.path(feature.geometry, landStyle);
	}

	if (worldAdmin0) {
		const adminStyle: PathStyle = {
			stroke: style.admin0Stroke,
			strokeWidthPx: sizes.adminStroke * scale
		};
		for (const feature of worldAdmin0.features) {
			insetRenderer.path(feature.geometry, adminStyle);
		}
	}

	// The "you are here" marker: the main map's own visible extent,
	// projected through the inset's projection — a rect when it measures
	// large enough to read as one, a dot otherwise (e.g. a short track
	// inside a continent-wide inset).
	const marker = minimapMarker(insetProjection, mapVisibleBbox, box, sizes.markerMinSizePx * scale);
	if (marker.kind === 'rect') {
		renderer.rect(marker.x, marker.y, marker.w, marker.h, {
			fill: style.minimapMarkerColor,
			opacity: 0.35,
			stroke: style.minimapMarkerColor,
			strokeWidthPx: sizes.markerStroke * scale
		});
	} else {
		renderer.circle(marker.xy, sizes.markerDotRadius * scale, { fill: style.minimapMarkerColor });
	}

	// Frame drawn last, on top of the marker, so it always reads as a crisp
	// panel edge rather than being crossed by a marker rect that touches it.
	renderer.rect(box.x, box.y, box.w, box.h, {
		stroke: style.admin0Stroke,
		strokeWidthPx: sizes.frameStroke * scale
	});
}
