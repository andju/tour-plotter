export interface TrackPoint {
	lon: number;
	lat: number;
	/** Elevation in meters, or null if the point carries none. */
	ele: number | null;
	/** ISO 8601 timestamp, or null if the point carries none. */
	time: string | null;
}

export interface TrackStyle {
	color: string;
	widthPx: number;
	opacity: number;
	visible: boolean;
}

/** Colorblind-safe categorical palette (Okabe-Ito), cycled by track index. */
const PALETTE = [
	'#E69F00',
	'#56B4E9',
	'#009E73',
	'#F0E442',
	'#0072B2',
	'#D55E00',
	'#CC79A7',
	'#000000'
];

export function defaultStyle(index: number): TrackStyle {
	return {
		color: PALETTE[index % PALETTE.length],
		widthPx: 3,
		opacity: 1,
		visible: true
	};
}

export interface Track {
	id: string;
	name: string;
	/** One array per <trkseg> (or the single implicit segment of a <rte>). */
	segments: TrackPoint[][];
	style: TrackStyle;
}

// Keyed on `segments` rather than `Track` itself: PreviewCanvas's draw effect
// shallow-clones each track per tick to force reactive reads of style fields
// (see PreviewCanvas.svelte), which would defeat a WeakMap keyed on the
// Track object — `segments` is the one property that clone still shares.
const geoJsonCache = new WeakMap<Track['segments'], GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>>();

/** A track's geometry as GeoJSON, for bbox/projection/rendering code that only cares about coordinates. */
export function trackToGeoJSON(track: Track): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> {
	const cached = geoJsonCache.get(track.segments);
	if (cached) return cached;

	const coordinates = track.segments.map((seg) => seg.map((p) => [p.lon, p.lat]));
	const feature: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> = {
		type: 'Feature',
		properties: { id: track.id },
		geometry:
			coordinates.length === 1
				? { type: 'LineString', coordinates: coordinates[0] }
				: { type: 'MultiLineString', coordinates }
	};
	geoJsonCache.set(track.segments, feature);
	return feature;
}
