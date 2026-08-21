import type { TrackStats } from './stats';

export function formatStats(stats: TrackStats): string {
	const parts = [`${stats.distanceKm.toFixed(1)} km`];
	if (stats.elevationGainM !== null) parts.push(`${Math.round(stats.elevationGainM)} m gain`);
	if (stats.durationSeconds !== null) parts.push(formatDuration(stats.durationSeconds));
	return parts.join(' · ');
}

function formatDuration(totalSeconds: number): string {
	const totalMinutes = Math.round(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `${minutes}m`;
	return `${hours}h ${minutes}m`;
}

/** Sums per-track stats into a combined figure for the overlay, when multiple tracks are visible. */
export function combineStats(all: TrackStats[]): TrackStats {
	return {
		distanceKm: all.reduce((sum, s) => sum + s.distanceKm, 0),
		elevationGainM: all.some((s) => s.elevationGainM !== null)
			? all.reduce((sum, s) => sum + (s.elevationGainM ?? 0), 0)
			: null,
		durationSeconds: all.some((s) => s.durationSeconds !== null)
			? all.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
			: null
	};
}
