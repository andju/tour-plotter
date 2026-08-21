import { GpxParseError, parseGpx } from '../gpx/parse';
import { defaultStyle, type Track, type TrackStyle } from '../gpx/types';

class TrackListState {
	// `$state.raw`, not deep `$state`: a deep proxy recursively wraps every
	// `TrackPoint` and every segment array in every Track, materialising a
	// Proxy plus its own signal for each the first time trackToGeoJSON
	// (gpx/types.ts) or computeStats (gpx/stats.ts) walks the points — about
	// 1KB of heap per GPX point against the ~40 bytes the point itself needs.
	// See PreviewCanvas.svelte's `loaded` comment for the same tradeoff in
	// more detail. Every mutation method below therefore assigns a whole new
	// array/Track/style object rather than mutating in place.
	tracks = $state.raw<Track[]>([]);
	errors = $state<string[]>([]);

	async addFiles(files: FileList | File[]): Promise<void> {
		const newErrors: string[] = [];
		// Accumulate locally and commit to this.tracks once: each push is a
		// reactive tick, and PreviewCanvas reacts to tracks changes by
		// refetching/decoding/composing the whole basemap, so N pushes means
		// N basemap pipelines for one drop instead of one.
		const newTracks: Track[] = [];

		for (const file of Array.from(files)) {
			try {
				const text = await file.text();
				const parsed = parseGpx(text, file.name);
				const offset = this.tracks.length + newTracks.length;
				newTracks.push(
					...parsed.map((track, i) => ({ ...track, style: defaultStyle(offset + i) }))
				);
			} catch (err) {
				newErrors.push(err instanceof GpxParseError ? err.message : `${file.name}: failed to parse`);
			}
		}

		if (newTracks.length > 0) this.tracks = [...this.tracks, ...newTracks];
		if (newErrors.length > 0) this.errors.push(...newErrors);
	}

	remove(id: string): void {
		this.tracks = this.tracks.filter((t) => t.id !== id);
	}

	updateStyle(id: string, style: Partial<TrackStyle>): void {
		this.tracks = this.tracks.map((t) => (t.id === id ? { ...t, style: { ...t.style, ...style } } : t));
	}

	rename(id: string, name: string): void {
		this.tracks = this.tracks.map((t) => (t.id === id ? { ...t, name } : t));
	}

	moveUp(id: string): void {
		const i = this.tracks.findIndex((t) => t.id === id);
		if (i <= 0) return;
		const next = [...this.tracks];
		[next[i - 1], next[i]] = [next[i], next[i - 1]];
		this.tracks = next;
	}

	moveDown(id: string): void {
		const i = this.tracks.findIndex((t) => t.id === id);
		if (i < 0 || i >= this.tracks.length - 1) return;
		const next = [...this.tracks];
		[next[i], next[i + 1]] = [next[i + 1], next[i]];
		this.tracks = next;
	}

	dismissErrors(): void {
		this.errors = [];
	}

	get visibleTracks(): Track[] {
		return this.tracks.filter((t) => t.style.visible);
	}
}

export const trackList = new TrackListState();
