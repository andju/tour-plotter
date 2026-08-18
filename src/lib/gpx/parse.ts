import { gpx as gpxToGeoJson } from '@tmcw/togeojson';
import { defaultStyle, type Track, type TrackPoint } from './types';

export class GpxParseError extends Error {}

/**
 * Parses a GPX document's text into one Track per <trk>/<rte> element.
 * Waypoints are ignored — this app renders paths, not points of interest.
 */
export function parseGpx(xmlText: string, sourceName: string): Track[] {
	const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

	const parserError = doc.getElementsByTagName('parsererror')[0];
	if (parserError) {
		throw new GpxParseError(`${sourceName}: not valid XML (${parserError.textContent?.trim()})`);
	}

	const collection = gpxToGeoJson(doc);

	const tracks: Track[] = [];
	let trackIndexInFile = 0;

	for (const feature of collection.features) {
		if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') {
			continue; // waypoints (Point) are not tracks
		}

		const segments = coordinatesToSegments(feature.geometry, feature.properties);
		if (segments.every((seg) => seg.length === 0)) continue;

		const name =
			(feature.properties?.name as string | undefined) ||
			`${sourceName} — track ${trackIndexInFile + 1}`;

		tracks.push({
			id: crypto.randomUUID(),
			name,
			segments,
			style: defaultStyle(trackIndexInFile)
		});
		trackIndexInFile++;
	}

	if (tracks.length === 0) {
		throw new GpxParseError(`${sourceName}: contains no tracks or routes`);
	}

	return tracks;
}

function coordinatesToSegments(
	geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
	properties: GeoJSON.GeoJsonProperties
): TrackPoint[][] {
	const lineStrings = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;

	// togeojson stores per-point times outside the geometry, shaped to match:
	// a flat string[] for a LineString, or string[][] for a MultiLineString.
	const rawTimes = properties?.coordinateProperties?.times as string[] | string[][] | undefined;
	const times: (string | undefined)[][] = lineStrings.map((line, i) => {
		if (!rawTimes) return [];
		const forSegment = geometry.type === 'LineString' ? (rawTimes as string[]) : (rawTimes as string[][])[i];
		return forSegment ?? [];
	});

	return lineStrings.map((line, segIndex) =>
		line.map((coord, ptIndex) => ({
			lon: coord[0],
			lat: coord[1],
			ele: coord.length > 2 ? coord[2] : null,
			time: times[segIndex]?.[ptIndex] ?? null
		}))
	);
}
