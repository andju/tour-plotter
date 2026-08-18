import { GpxParseError, parseGpx } from '../gpx/parse';
import { defaultStyle, type Track, type TrackStyle } from '../gpx/types';

class TrackListState {
	tracks = $state<Track[]>([]);
	errors = $state<string[]>([]);

	async addFiles(files: FileList | File[]): Promise<void> {
		const newErrors: string[] = [];

		for (const file of Array.from(files)) {
			try {
				const text = await file.text();
				const parsed = parseGpx(text, file.name);
				const offset = this.tracks.length;
				parsed.forEach((track, i) => {
					track.style = defaultStyle(offset + i);
				});
				this.tracks.push(...parsed);
			} catch (err) {
				newErrors.push(err instanceof GpxParseError ? err.message : `${file.name}: failed to parse`);
			}
		}

		if (newErrors.length > 0) this.errors.push(...newErrors);
	}

	remove(id: string): void {
		this.tracks = this.tracks.filter((t) => t.id !== id);
	}

	updateStyle(id: string, style: Partial<TrackStyle>): void {
		const track = this.tracks.find((t) => t.id === id);
		if (track) Object.assign(track.style, style);
	}

	rename(id: string, name: string): void {
		const track = this.tracks.find((t) => t.id === id);
		if (track) track.name = name;
	}

	moveUp(id: string): void {
		const i = this.tracks.findIndex((t) => t.id === id);
		if (i > 0) [this.tracks[i - 1], this.tracks[i]] = [this.tracks[i], this.tracks[i - 1]];
	}

	moveDown(id: string): void {
		const i = this.tracks.findIndex((t) => t.id === id);
		if (i >= 0 && i < this.tracks.length - 1) [this.tracks[i], this.tracks[i + 1]] = [this.tracks[i + 1], this.tracks[i]];
	}

	dismissErrors(): void {
		this.errors = [];
	}

	get visibleTracks(): Track[] {
		return this.tracks.filter((t) => t.style.visible);
	}
}

export const trackList = new TrackListState();
