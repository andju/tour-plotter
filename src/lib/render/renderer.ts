export interface PathStyle {
	stroke?: string;
	strokeWidthPx?: number;
	fill?: string;
	opacity?: number;
	/** Alternating dash/gap lengths in px, pre-scaled like every other length. */
	dashPx?: number[];
}

export interface FillStyle {
	fill: string;
	opacity?: number;
}

export interface Font {
	sizePx: number;
	family: string;
	weight?: string;
}

export interface TextStyle {
	font: Font;
	fill: string;
	anchor?: 'start' | 'middle' | 'end';
	/** Outline drawn under the fill, so labels stay legible over any basemap layer beneath them. */
	haloColor?: string;
	haloWidthPx?: number;
}

/**
 * Draw target abstraction. Geometry-bearing calls (`path`) take raw
 * lon/lat GeoJSON — the renderer owns the projection and converts to
 * pixels itself, via the same d3.geoPath instance for every op, so a
 * Canvas render and an SVG render of the same scene always agree.
 * Point-ish calls (`circle`, `text`, `rect`) take pixel coordinates
 * directly, since their positions (e.g. label placement) are already
 * computed in pixel space upstream.
 */
export interface Renderer {
	path(geometry: GeoJSON.Geometry, style: PathStyle): void;
	circle(xy: [number, number], radiusPx: number, style: FillStyle): void;
	text(xy: [number, number], value: string, style: TextStyle): void;
	rect(x: number, y: number, w: number, h: number, style: FillStyle): void;
}
