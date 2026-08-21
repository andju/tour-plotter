import length from '@turf/length';
import { trackToGeoJSON, type Track } from './types';

export interface TrackStats {
	distanceKm: number;
	/** null when the track carries no elevation data. */
	elevationGainM: number | null;
	/** null when the track carries no (or incomplete) timestamps. */
	durationSeconds: number | null;
}

/**
 * Elevation below this rise (in meters) is treated as GPS noise rather than
 * a real climb. Consumer GPS elevation is noisy at the +-2-5m level;
 * summing every raw up-tick inflates total gain by 2-3x on a long track.
 * This is a hysteresis filter: only count a climb once it has continued
 * past the threshold from the last confirmed turning point.
 */
const ELEVATION_NOISE_THRESHOLD_M = 5;

// Keyed on `segments`, not `Track` — see the matching cache in gpx/types.ts
// for why. This is what keeps a track-style-only edit (colour/width/opacity)
// from re-summing every GPX point on every tick.
const statsCache = new WeakMap<Track['segments'], TrackStats>();

export function computeStats(track: Track): TrackStats {
	const cached = statsCache.get(track.segments);
	if (cached) return cached;

	const stats: TrackStats = {
		distanceKm: length(trackToGeoJSON(track)),
		elevationGainM: elevationGain(track),
		durationSeconds: duration(track)
	};
	statsCache.set(track.segments, stats);
	return stats;
}

function elevationGain(track: Track): number | null {
	let gain = 0;
	let sawElevation = false;

	for (const segment of track.segments) {
		const elevations = segment.map((p) => p.ele).filter((e): e is number => e !== null);
		if (elevations.length === 0) continue;
		sawElevation = true;

		let base = elevations[0];
		for (const ele of elevations.slice(1)) {
			const delta = ele - base;
			if (delta > ELEVATION_NOISE_THRESHOLD_M) {
				gain += delta;
				base = ele;
			} else if (delta < -ELEVATION_NOISE_THRESHOLD_M) {
				base = ele;
			}
			// else: within the noise band, ignore and keep the current base
		}
	}

	return sawElevation ? gain : null;
}

function duration(track: Track): number | null {
	let total = 0;
	let sawDuration = false;

	for (const segment of track.segments) {
		const times = segment.map((p) => p.time).filter((t): t is string => t !== null);
		if (times.length < 2) continue;

		const start = Date.parse(times[0]);
		const end = Date.parse(times[times.length - 1]);
		if (Number.isNaN(start) || Number.isNaN(end)) continue;
		if (end < start) continue;

		total += (end - start) / 1000;
		sawDuration = true;
	}

	return sawDuration ? total : null;
}
