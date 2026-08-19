import type { GeoProjection } from 'd3-geo';
import { CITY_SIZE_MAX } from '../basemap/placeSize';
import type { BasemapLayers, PlaceProperties } from '../basemap/types';
import { bboxIntersects, featureBbox } from './cull';
import type { Bbox } from '../geo/bbox';
import { trackToGeoJSON, type Track } from '../gpx/types';
import { visibleAt, zoomForProjection, type DetailBias } from './detail';
import { placeLabels, type LabelCandidate } from './labels';
import { buildInsetProjection, minimapBbox, minimapBox, minimapMarker } from './minimap';
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
 * Line-height multiplier applied to a reference font size to get the height
 * of one line of text plus a little breathing space above/below it. Sizes
 * the neutral background box `drawLabelWithBackground` paints behind the
 * title text.
 */
const TEXT_BAND_LINE_HEIGHT = 1.5;

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

/** Linear interpolation across a place's size, 0 (largest) to CITY_SIZE_MAX (smallest). */
function sizeLerp(size: number, largest: number, smallest: number): number {
	const t = Math.min(1, Math.max(0, size / CITY_SIZE_MAX));
	return largest + (smallest - largest) * t;
}

function drawPlaces(renderer: Renderer, input: SceneInput, scale: number, mapBottom: number): void {
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
		if (x < 0 || y < 0 || x > outputWidth || y > mapBottom) return;

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

/** Extra breathing room (at the 1000px reference width) between the stats text and the scale bar's label, above the spacing already implied by their font sizes. */
const BOTTOM_LEFT_STACK_GAP_PX = 6;

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
			y -= barHeightPx + font.sizePx * 1.6 + BOTTOM_LEFT_STACK_GAP_PX * scale;
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
 * read as a strip painted across the whole image. Used for the title, which
 * is prominent enough to warrant a solid backing plate; the smaller
 * stats/scale-bar/credit text uses a per-glyph halo instead (see their
 * `haloColor`/`haloWidthPx`), since a filled box there would cover more of
 * the map than three short lines need.
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
 * The title floats directly over the map, anchored to the corner/edge
 * `overlay.titlePosition` picks — nothing reserves space for it, so it sits
 * on top of whatever basemap/track content is already there. `marginPx` is
 * already in output-pixel space (see `drawBottomLeft`/`drawCredit`, which
 * use it the same way), unlike `font.sizePx` which is derived from the
 * 1000px-reference `style` and scaled here.
 */
function drawTitle(renderer: Renderer, input: SceneInput, scale: number): void {
	const { overlay, style, outputWidth, outputHeight, marginPx } = input;
	if (!overlay.title) return;

	const font: Font = { sizePx: style.referenceFontSizePx.title * scale, family: style.fontFamily, weight: 'bold' };
	const boxHeightPx = font.sizePx * TEXT_BAND_LINE_HEIGHT;
	const isTop = overlay.titlePosition.startsWith('top');
	const y = isTop ? marginPx + boxHeightPx / 2 : outputHeight - marginPx - boxHeightPx / 2;

	const anchor: 'start' | 'middle' | 'end' = overlay.titlePosition.endsWith('left')
		? 'start'
		: overlay.titlePosition.endsWith('right')
			? 'end'
			: 'middle';
	const x = anchor === 'start' ? marginPx : anchor === 'end' ? outputWidth - marginPx : outputWidth / 2;

	drawLabelWithBackground(renderer, input, [x, y], overlay.title, font, anchor);
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
 */
function drawMinimap(renderer: Renderer, input: SceneInput, scale: number): void {
	const { overlay, style, worldLand, worldAdmin0, outputWidth, outputHeight, marginPx, visibleBbox: mapVisibleBbox } = input;
	if (!overlay.showMinimap || !worldLand) return;

	const sizes = style.referenceMinimapPx;
	const widthPx = sizes.width * scale;
	const innerMarginPx = sizes.innerMarginPx * scale;

	const bbox = minimapBbox(mapVisibleBbox, overlay.minimapCoverageKm);
	const box = minimapBox(overlay.minimapPosition, outputWidth, outputHeight, marginPx, widthPx, bbox);

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
