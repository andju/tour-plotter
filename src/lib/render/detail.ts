import type { GeoProjection } from 'd3-geo';

/**
 * Effective web-Mercator zoom of a d3 geoMercator projection. A standard
 * web-Mercator world at zoom z spans 256 * 2^z px; d3's geoMercator spans
 * 2*PI*scale() px at scale 1. Equating the two and solving for z gives the
 * zoom this projection's current framing corresponds to — used both to pick
 * an OSM tile zoom and to thin Natural Earth's min_zoom-tagged features, so
 * both basemap sources back off detail together as a track's frame widens.
 */
export function zoomForProjection(projection: GeoProjection): number {
	const k = projection.scale();
	return Math.log2((2 * Math.PI * k) / 256);
}

export type DetailBias = 'minimal' | 'balanced' | 'rich';

const BIAS_OFFSET: Record<DetailBias, number> = {
	minimal: -1.5,
	balanced: 0,
	rich: 1.5
};

/**
 * Whether a feature tagged with a Natural-Earth-style `min_zoom` should be
 * drawn at the given framing zoom. `minZoom` of `null`/`undefined` (features
 * with no such tag, e.g. admin borders) is always visible.
 */
export function visibleAt(minZoom: number | null | undefined, zoom: number, bias: DetailBias): boolean {
	if (minZoom == null) return true;
	return zoom + BIAS_OFFSET[bias] >= minZoom;
}
