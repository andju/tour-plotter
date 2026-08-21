import { geoBounds } from 'd3-geo';
import { trackToGeoJSON, type Track } from '../gpx/types';

/**
 * [minLon, minLat, maxLon, maxLat]. When the bbox crosses the antimeridian,
 * minLon > maxLon by convention (the wrap is the "short way" through +-180),
 * matching d3-geo's geoBounds output that this is built on.
 */
export type Bbox = [number, number, number, number];

const KM_PER_DEG_LAT = 111.32;

export function bboxOfTracks(tracks: Track[]): Bbox {
	if (tracks.length === 0) {
		throw new Error('bboxOfTracks: at least one track is required');
	}

	// geoBounds computes the true spherical bounding box, correctly handling
	// geometries that cross the antimeridian — a naive planar min/max over
	// raw longitudes gets this badly wrong (it would report a ~358deg-wide
	// box instead of the actual few-degree-wide one).
	const [[minLon, minLat], [maxLon, maxLat]] = geoBounds({
		type: 'FeatureCollection',
		features: tracks.map(trackToGeoJSON)
	});

	return [minLon, minLat, maxLon, maxLat];
}

export function normalizeLon(lon: number): number {
	if (lon === 180) return 180;
	return (((lon + 180) % 360) + 360) % 360 - 180;
}

export function bboxWidthDeg(minLon: number, maxLon: number): number {
	return minLon <= maxLon ? maxLon - minLon : 360 - minLon + maxLon;
}

/**
 * Expands a bbox about its center so each dimension spans at least `minKm`.
 * Bboxes that already meet the minimum are returned unchanged (well,
 * recentered — see note below).
 *
 * This exists so small tracks don't get framed at true street-level zoom,
 * where even OSM tile data (this app's default basemap source) has nothing
 * left to show beyond individual buildings. The default floor is set low
 * enough for the OSM source to still have water, towns and urban areas at
 * a short track's natural framing — see the note on `minCoverageKm` in
 * settings.svelte.ts. Natural Earth mode, which has real content only at
 * wide/continental scales, is expected to look sparse at this floor.
 */
export function expandToMinimumCoverage(bbox: Bbox, minKm: number): Bbox {
	const [minLon, minLat, maxLon, maxLat] = bbox;

	const widthDeg = bboxWidthDeg(minLon, maxLon);
	const heightDeg = maxLat - minLat;
	const centerLon = normalizeLon(minLon + widthDeg / 2);
	const centerLat = (minLat + maxLat) / 2;

	// Degrees of longitude per km shrink toward the poles (cos(lat) -> 0);
	// clamp so a high-latitude track doesn't demand an absurd degree span.
	const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);

	const currentWidthKm = widthDeg * KM_PER_DEG_LAT * cosLat;
	const currentHeightKm = heightDeg * KM_PER_DEG_LAT;

	const targetWidthKm = Math.max(currentWidthKm, minKm);
	const targetHeightKm = Math.max(currentHeightKm, minKm);

	const targetWidthDeg = Math.min(targetWidthKm / (KM_PER_DEG_LAT * cosLat), 360);
	const targetHeightDeg = Math.min(targetHeightKm / KM_PER_DEG_LAT, 180);

	const newMinLat = Math.max(centerLat - targetHeightDeg / 2, -90);
	const newMaxLat = Math.min(centerLat + targetHeightDeg / 2, 90);

	// A full-width span is the whole globe; go through the ordinary
	// (non-wrapping) representation rather than the wrap math below, which
	// degenerates to a zero-width box when the two edges land on the same
	// antipodal meridian.
	if (targetWidthDeg >= 359.99) {
		return [-180, newMinLat, 180, newMaxLat];
	}

	const newMinLon = normalizeLon(centerLon - targetWidthDeg / 2);
	const newMaxLon = normalizeLon(centerLon + targetWidthDeg / 2);

	return [newMinLon, newMinLat, newMaxLon, newMaxLat];
}
