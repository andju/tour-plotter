import { beforeEach, describe, expect, it } from 'vitest';
import { trackList } from './tracks.svelte';

function gpxFile(name: string, trackCount: number): File {
	const trk = (n: number) =>
		`<trk><name>${name} ${n}</name><trkseg><trkpt lat="${n}" lon="${n}"/><trkpt lat="${n + 1}" lon="${n + 1}"/></trkseg></trk>`;
	const body = Array.from({ length: trackCount }, (_, i) => trk(i)).join('');
	const xml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
	return new File([xml], name, { type: 'application/gpx+xml' });
}

describe('TrackListState.addFiles', () => {
	beforeEach(() => {
		trackList.tracks = [];
		trackList.errors = [];
	});

	it('assigns distinct default colors to tracks in the same file', async () => {
		await trackList.addFiles([gpxFile('same.gpx', 2)]);

		expect(trackList.tracks).toHaveLength(2);
		expect(trackList.tracks[0].style.color).not.toBe(trackList.tracks[1].style.color);
	});

	it('assigns distinct default colors to tracks loaded across separate files', async () => {
		await trackList.addFiles([gpxFile('first.gpx', 1)]);
		await trackList.addFiles([gpxFile('second.gpx', 1)]);

		expect(trackList.tracks).toHaveLength(2);
		expect(trackList.tracks[0].style.color).not.toBe(trackList.tracks[1].style.color);
	});

	it('adds tracks from multiple files passed to a single addFiles call, in order, with distinct colors', async () => {
		await trackList.addFiles([
			gpxFile('a.gpx', 1),
			gpxFile('b.gpx', 1),
			gpxFile('c.gpx', 1)
		]);

		expect(trackList.tracks).toHaveLength(3);
		expect(trackList.tracks.map((t) => t.name)).toEqual(['a.gpx 0', 'b.gpx 0', 'c.gpx 0']);
		const colors = trackList.tracks.map((t) => t.style.color);
		expect(new Set(colors).size).toBe(3);
	});
});
