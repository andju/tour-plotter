import { geoMercator, type GeoProjection } from 'd3-geo';
import { bboxWidthDeg, normalizeLon, type Bbox } from './bbox';

const EDGE_SAMPLES = 32;

/**
 * Builds a Mercator projection that fits `bbox` into a `width` x `height`
 * canvas, inset by `marginPx` on every side.
 *
 * This computes scale/translate by hand rather than via d3-geo's
 * `fitExtent(extent, polygon)`, which turned out to have two sharp edges
 * for this use case:
 *
 * 1. `fitExtent` measures a Polygon through `geoPath.bounds`, which
 *    depends on ring winding to decide which side of the ring is
 *    "inside". A plain axis-aligned rectangle ring is not guaranteed to
 *    win that ambiguity check, and on the losing side d3-geo falls back
 *    to the bounds of the *entire sphere* — silently producing a hugely
 *    zoomed-out projection instead of an error. Reproduced empirically:
 *    identical (wrong) 2*PI x 2*PI raw bounds for two different rings.
 * 2. Even with correct winding, `geoPath` treats ring edges as
 *    great-circle arcs. A rectangle's top/bottom edges are lines of
 *    constant latitude, not great circles, so a great circle between two
 *    same-latitude, longitude-separated corners bulges poleward between
 *    them — inflating the measured height of a wide/flat bbox.
 *
 * Sampling points directly (never building a Polygon) sidesteps both:
 * there is no ring to mis-wind, and each sample already sits exactly on
 * the intended parallel/meridian rather than a chord between them.
 *
 * The projection is pre-rotated so the bbox's own center longitude maps
 * to 0 before any sampling happens. This moves the antimeridian
 * (Mercator's branch cut) away from the region of interest, so bboxes
 * that cross it (minLon > maxLon, see Bbox) are handled the same as any
 * other bbox — no special-casing needed past this point.
 */
export function buildProjection(width: number, height: number, bbox: Bbox, marginPx: number): GeoProjection {
	const [minLon, minLat, maxLon, maxLat] = bbox;
	const centerLon = normalizeLon(minLon + bboxWidthDeg(minLon, maxLon) / 2);

	const probe = geoMercator().scale(1).translate([0, 0]).rotate([-centerLon, 0]);
	const samples = rectangleEdgeSamples(bbox);

	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const point of samples) {
		const projected = probe(point);
		if (!projected) continue;
		const [x, y] = projected;
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}

	const availableWidth = width - 2 * marginPx;
	const availableHeight = height - 2 * marginPx;
	const scale = Math.min(availableWidth / (x1 - x0), availableHeight / (y1 - y0));

	const centerX = (x0 + x1) / 2;
	const centerY = (y0 + y1) / 2;
	const translate: [number, number] = [width / 2 - centerX * scale, height / 2 - centerY * scale];

	// Adaptive resampling (d3-geo's default projection.precision) subdivides
	// every edge to keep curvature error under a threshold — worthwhile for a
	// coarse polygon rendered at continental scale, but this app's data is
	// already dense (Natural Earth 50m, OSM vector tiles), so it mostly just
	// re-walks edges that are already straight in practice. Disabling it
	// (precision 0) cuts the geoPath projection stream time by 30-50% with a
	// negligible point-count difference — measured within ~5% of emitted
	// points at every framing this app produces, from a single track's
	// regional frame to a multi-country tour.
	return geoMercator().rotate([-centerLon, 0]).scale(scale).translate(translate).precision(0);
}

/**
 * The full geographic extent visible on the canvas, as opposed to the bbox
 * `buildProjection` was fit to. Fitting preserves aspect ratio via a single
 * uniform `scale` (see above), so only the binding axis (plus the margin)
 * ends exactly at the bbox edge; the other axis shows real map area beyond
 * it, framed on both sides equally around the bbox's center. A basemap
 * source that fetches data by bbox (the OSM tile source) needs this wider
 * extent, or that extra strip renders with no data.
 *
 * Two corners suffice: geoMercator's `x` depends only on (rotated)
 * longitude and `y` only on latitude, so each axis inverts independently of
 * the other. `invert` is non-null here because raw Mercator, unlike e.g.
 * orthographic, has no domain restriction that would make a point
 * unprojectable.
 */
export function visibleBbox(projection: GeoProjection, width: number, height: number): Bbox {
	const [minLon, maxLat] = projection.invert!([0, 0])!;
	const [maxLon, minLat] = projection.invert!([width, height])!;
	return [minLon, minLat, maxLon, maxLat];
}

/** Points along all 4 edges of the bbox rectangle, hugging its parallels/meridians. */
function rectangleEdgeSamples(bbox: Bbox): [number, number][] {
	const [minLon, minLat, maxLon, maxLat] = bbox;

	const bottom = lerpLon(minLon, maxLon).map((lon): [number, number] => [lon, minLat]);
	const right = lerpRange(minLat, maxLat).map((lat): [number, number] => [maxLon, lat]);
	const top = lerpLon(maxLon, minLon).map((lon): [number, number] => [lon, maxLat]);
	const left = lerpRange(maxLat, minLat).map((lat): [number, number] => [minLon, lat]);

	return [...bottom, ...right, ...top, ...left];
}

function lerpRange(from: number, to: number): number[] {
	return Array.from({ length: EDGE_SAMPLES }, (_, i) => from + ((to - from) * i) / (EDGE_SAMPLES - 1));
}

/** Interpolates the short way around, even when that crosses +-180. */
function lerpLon(from: number, to: number): number[] {
	let delta = to - from;
	if (delta > 180) delta -= 360;
	if (delta < -180) delta += 360;
	return lerpRange(from, from + delta);
}
