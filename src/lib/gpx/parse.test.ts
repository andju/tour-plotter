import { describe, expect, it } from 'vitest';
import { GpxParseError, parseGpx } from './parse';

function gpxDoc(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

describe('parseGpx', () => {
	it('parses a multi-segment track into one Track with multiple segments', () => {
		const [track] = parseGpx(
			gpxDoc(`
				<trk><name>Ride</name>
					<trkseg>
						<trkpt lat="52.52" lon="13.405"><ele>34.5</ele><time>2026-01-01T08:00:00Z</time></trkpt>
						<trkpt lat="52.521" lon="13.406"><ele>36.1</ele><time>2026-01-01T08:00:10Z</time></trkpt>
					</trkseg>
					<trkseg>
						<trkpt lat="52.53" lon="13.41"><ele>40.0</ele><time>2026-01-01T08:05:00Z</time></trkpt>
						<trkpt lat="52.531" lon="13.411"><ele>41.0</ele><time>2026-01-01T08:05:10Z</time></trkpt>
					</trkseg>
				</trk>`),
			'ride.gpx'
		);

		expect(track.name).toBe('Ride');
		expect(track.segments).toHaveLength(2);
		expect(track.segments[0]).toHaveLength(2);
		expect(track.segments[1]).toHaveLength(2);
		expect(track.segments[0][0]).toEqual({ lon: 13.405, lat: 52.52, ele: 34.5, time: '2026-01-01T08:00:00Z' });
	});

	it('parses multiple <trk> elements in one file into multiple tracks', () => {
		const tracks = parseGpx(
			gpxDoc(`
				<trk><name>First</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>
				<trk><name>Second</name><trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg></trk>`),
			'multi.gpx'
		);

		expect(tracks).toHaveLength(2);
		expect(tracks.map((t) => t.name)).toEqual(['First', 'Second']);
	});

	it('handles points with missing elevation', () => {
		const [track] = parseGpx(
			gpxDoc(`<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"><ele>10</ele></trkpt></trkseg></trk>`),
			'noele.gpx'
		);

		expect(track.segments[0][0].ele).toBeNull();
		expect(track.segments[0][1].ele).toBe(10);
	});

	it('handles points with missing timestamps', () => {
		const [track] = parseGpx(
			gpxDoc(`<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`),
			'notime.gpx'
		);

		expect(track.segments[0][0].time).toBeNull();
		expect(track.segments[0][1].time).toBeNull();
	});

	it('parses <rte> elements as tracks', () => {
		const tracks = parseGpx(
			gpxDoc(`<rte><name>A Route</name><rtept lat="5" lon="6"/><rtept lat="6" lon="7"/></rte>`),
			'route.gpx'
		);

		expect(tracks).toHaveLength(1);
		expect(tracks[0].name).toBe('A Route');
		expect(tracks[0].segments[0]).toHaveLength(2);
	});

	it('ignores waypoints', () => {
		const tracks = parseGpx(
			gpxDoc(`
				<wpt lat="1" lon="2"><name>WP</name></wpt>
				<trk><name>Real Track</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`),
			'wpt.gpx'
		);

		expect(tracks).toHaveLength(1);
		expect(tracks[0].name).toBe('Real Track');
	});

	it('falls back to a generated name when a track has none', () => {
		const [track] = parseGpx(
			gpxDoc(`<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`),
			'unnamed.gpx'
		);

		expect(track.name).toContain('unnamed.gpx');
	});

	it('assigns distinct default colors to tracks in the same file', () => {
		const tracks = parseGpx(
			gpxDoc(`
				<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>
				<trk><trkseg><trkpt lat="3" lon="3"/><trkpt lat="4" lon="4"/></trkseg></trk>`),
			'colors.gpx'
		);

		expect(tracks[0].style.color).not.toBe(tracks[1].style.color);
	});

	it('throws GpxParseError on malformed XML', () => {
		expect(() => parseGpx('<gpx><trk>', 'broken.gpx')).toThrow(GpxParseError);
	});

	it('throws GpxParseError when the file has no tracks or routes', () => {
		expect(() => parseGpx(gpxDoc(`<wpt lat="1" lon="2"/>`), 'onlywpt.gpx')).toThrow(GpxParseError);
	});
});
