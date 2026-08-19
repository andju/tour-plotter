import type { GeoProjection } from 'd3-geo';
import { expandToMinimumCoverage, type Bbox } from '../geo/bbox';
import { buildProjection, projectedAspect } from '../geo/projection';
import type { OverlayPosition } from './scene';

/**
 * Latitude clamp applied to the minimap's own framing bbox. Two reasons this
 * has to happen here rather than being left to `expandToMinimumCoverage`
 * (which clamps to ±90): `buildProjection` probes bbox corners through a raw
 * `geoMercator`, and Mercator's y diverges to infinity at the poles — a ±90°
 * corner would poison the min/max scan into a NaN scale. ±84° is the
 * standard Mercator/Web-Mercator practical limit (where projected y crosses
 * roughly the same magnitude as x at zoom 0) and stays comfortably finite.
 */
const MAX_ABS_LAT = 84;

export interface MinimapBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The geographic extent the minimap frames: `coverageKm` around the tour's
 * own bbox (reusing the same helper the main map's minimum-coverage floor
 * uses — see bbox.ts), clamped in latitude so the projection below it never
 * blows up. At the slider's top end this reaches a full-width, near-global
 * view; there is no separate "world" mode; the clamp alone provides it.
 */
export function minimapBbox(framingBbox: Bbox, coverageKm: number): Bbox {
	const [minLon, minLat, maxLon, maxLat] = expandToMinimumCoverage(framingBbox, coverageKm);
	return [minLon, Math.max(minLat, -MAX_ABS_LAT), maxLon, Math.min(maxLat, MAX_ABS_LAT)];
}

/**
 * The inset's pixel box for a given anchor, mirroring `drawTitle`'s
 * corner/edge arithmetic in scene.ts (top/bottom picks y, left/center/right
 * picks x) so the two controls read the same way to a user positioning
 * either. Height follows `bbox`'s own projected aspect ratio (see
 * `projectedAspect`) rather than a fixed square, clamped so an extreme
 * (near-polar) extent can't blow the box out to an unusable height.
 */
export function minimapBox(
	position: OverlayPosition,
	outputWidth: number,
	outputHeight: number,
	marginPx: number,
	widthPx: number,
	bbox: Bbox
): MinimapBox {
	const aspect = Math.min(projectedAspect(bbox), 1.4);
	const h = widthPx * aspect;

	const isTop = position.startsWith('top');
	const y = isTop ? marginPx : outputHeight - marginPx - h;

	const x = position.endsWith('left')
		? marginPx
		: position.endsWith('right')
			? outputWidth - marginPx - widthPx
			: outputWidth / 2 - widthPx / 2;

	return { x, y, w: widthPx, h };
}

/**
 * A projection fit to `bbox` inside `box` (with `innerMarginPx` breathing
 * room), then clipped to the box in screen space — `buildProjection` is
 * reused verbatim (it's stateless and takes its own size, see its header
 * comment on why a second independent call is safe), just post-translated
 * from a 0,0-origin fit to `box`'s actual position on the canvas.
 */
export function buildInsetProjection(box: MinimapBox, bbox: Bbox, innerMarginPx: number): GeoProjection {
	const fitted = buildProjection(box.w, box.h, bbox, innerMarginPx);
	const [tx, ty] = fitted.translate();
	fitted.translate([tx + box.x, ty + box.y]);
	return fitted.clipExtent([
		[box.x, box.y],
		[box.x + box.w, box.y + box.h]
	]);
}

export type MinimapMarker = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'dot'; xy: [number, number] };

/**
 * Where the main map's own visible extent falls inside the inset — the
 * "you are here" indicator. Projects the two corners of `visibleBbox`
 * through the already-built (and already-clipped) inset projection, clamps
 * the result to the box (a wide/global inset can otherwise place a corner
 * off the box when the main map's extent pokes past the inset's own,
 * clamped framing), and falls back to a centered dot when the projected
 * rectangle is too small to read as a box.
 */
export function minimapMarker(insetProjection: GeoProjection, visibleBbox: Bbox, box: MinimapBox, minSizePx: number): MinimapMarker {
	const clampX = (x: number) => Math.min(Math.max(x, box.x), box.x + box.w);
	const clampY = (y: number) => Math.min(Math.max(y, box.y), box.y + box.h);

	const [minLon, minLat, maxLon, maxLat] = visibleBbox;
	const topLeft = insetProjection([minLon, maxLat]);
	const bottomRight = insetProjection([maxLon, minLat]);

	if (!topLeft || !bottomRight) {
		const centerX = box.x + box.w / 2;
		const centerY = box.y + box.h / 2;
		return { kind: 'dot', xy: [centerX, centerY] };
	}

	const x0 = clampX(Math.min(topLeft[0], bottomRight[0]));
	const x1 = clampX(Math.max(topLeft[0], bottomRight[0]));
	const y0 = clampY(Math.min(topLeft[1], bottomRight[1]));
	const y1 = clampY(Math.max(topLeft[1], bottomRight[1]));

	const w = x1 - x0;
	const h = y1 - y0;
	if (w < minSizePx || h < minSizePx) {
		return { kind: 'dot', xy: [(x0 + x1) / 2, (y0 + y1) / 2] };
	}
	return { kind: 'rect', x: x0, y: y0, w, h };
}
