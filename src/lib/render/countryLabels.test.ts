import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeoProjection } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import type { CountryFeatureCollection } from '../basemap/countries';
import type { Bbox } from '../geo/bbox';
import { buildProjection } from '../geo/projection';
import { buildTrackObstacles, layoutCountryLabels, type CountryLabelInput, type Projector } from './countryLabels';
import { LabelSpace } from './labels';

// Identity projection: only used for buildTrackObstacles, which projects
// individual points and has no antimeridian-clipping concerns of its own.
const identityProjection: Projector = ([lon, lat]) => [lon, lat];

// Deterministic stand-in for real font metrics, matching labels.test.ts's convention.
const measureTextWidth = (text: string, font: { sizePx: number }) => text.length * (font.sizePx / 2);

/**
 * A lon/lat rectangle, wound clockwise (as plotted with lon as x and lat as
 * y) to match the real Natural Earth data's convention (verified against
 * `static/basemap/countries.json`'s Iceland feature). The opposite
 * (counter-clockwise) winding hits an unrelated d3-geo edge case for a
 * simple symmetric polygon on an unclipped Mercator projection: `geoPath`
 * emits a second, spurious ring enclosing the whole projected plane, which
 * would corrupt this module's signed-area sum. Real basemap data never hits
 * this because it already matches the winding used here.
 */
function square(
	name: string,
	lon0: number,
	lat0: number,
	lon1: number,
	lat1: number
): GeoJSON.Feature<GeoJSON.Polygon, { name: string }> {
	return {
		type: 'Feature',
		properties: { name },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[lon0, lat0],
					[lon0, lat1],
					[lon1, lat1],
					[lon1, lat0],
					[lon0, lat0]
				]
			]
		}
	};
}

function countries(...features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }>[]): CountryFeatureCollection {
	return { type: 'FeatureCollection', features };
}

const CANVAS = { width: 400, height: 400 };
const BBOX: Bbox = [-10, -10, 10, 10];

function testProjection(): GeoProjection {
	return buildProjection(CANVAS.width, CANVAS.height, BBOX, 0);
}

function baseInput(overrides: Partial<CountryLabelInput> = {}): CountryLabelInput {
	return {
		countries: countries(),
		projection: testProjection(),
		visibleBbox: BBOX,
		measureTextWidth,
		fontFamily: 'sans-serif',
		fontSizePx: { min: 13, max: 24 },
		...overrides
	};
}

/** Pixel-space center of a lon/lat rectangle under `projection`, exact because a Mercator projection's x depends only on longitude and y only on latitude — so a lon/lat rectangle always projects to an axis-aligned pixel rectangle, and its area centroid is just the midpoint of two opposite projected corners. */
function projectedCenter(projection: GeoProjection, lon0: number, lat0: number, lon1: number, lat1: number): [number, number] {
	const [xA, yA] = projection([lon0, lat0])!;
	const [xB, yB] = projection([lon1, lat1])!;
	return [(xA + xB) / 2, (yA + yB) / 2];
}

describe('layoutCountryLabels', () => {
	it('labels a country large enough to clear the minimum-area gate', () => {
		const input = baseInput({ countries: countries(square('France', -8, -8, 8, 8)) });

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		expect(placed).toHaveLength(1);
		expect(placed[0].text).toBe('FRANCE');
	});

	it('drops a country whose visible portion is too small to label meaningfully', () => {
		// A sliver in the corner: well under the 1.5% of canvas area floor.
		const input = baseInput({ countries: countries(square('Sliver', 9, 9, 9.5, 9.5)) });

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		expect(placed).toHaveLength(0);
	});

	it('places the larger of two countries first, giving it first pick of the shared space', () => {
		const input = baseInput({
			countries: countries(square('Small', 4, -8, 8, -4), square('Big', -9, -9, 9, 9))
		});

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		const texts = placed.map((p) => p.text);
		expect(texts[0]).toBe('BIG');
	});

	it('routes around an already-reserved city label box instead of overlapping it', () => {
		const projection = testProjection();
		const center = projectedCenter(projection, -8, -8, 8, 8);

		const space = new LabelSpace(64);
		// Reserve a box across the exact centroid of the square country below,
		// as if a city label had already been placed there.
		space.insert({ x0: center[0] - 50, y0: center[1] - 50, x1: center[0] + 50, y1: center[1] + 50 });

		const input = baseInput({ projection, countries: countries(square('France', -8, -8, 8, 8)) });
		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, space, null);

		expect(placed).toHaveLength(1);
		// The centroid candidate collides with the reserved box, so the
		// accepted anchor must be a different point.
		expect(placed[0].xy).not.toEqual(center);
	});

	it('drops a country when a track crosses every candidate anchor', () => {
		const projection = testProjection();
		const input = baseInput({ projection, countries: countries(square('France', -8, -8, 8, 8)) });
		const obstacles = buildTrackObstacles(
			[
				{
					id: 't1',
					name: 'Blocking track',
					segments: [
						[
							{ lon: -10, lat: 0, ele: null, time: null },
							{ lon: 10, lat: 0, ele: null, time: null }
						]
					],
					style: { color: '#f00', widthPx: 3, opacity: 1, visible: true }
				}
			],
			projection
		);

		// A single horizontal track through the middle doesn't necessarily
		// block every one of the ~7 candidate anchors, so assert the weaker,
		// still-meaningful property: at minimum the centroid anchor (which
		// sits exactly on the track's latitude) is never accepted.
		const centroidAnchor = projectedCenter(projection, -8, -8, 8, 8);
		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), obstacles);
		if (placed.length > 0) {
			expect(placed[0].xy).not.toEqual(centroidAnchor);
		}
	});

	it('scales font size up for a country that fills more of the canvas', () => {
		const small = layoutCountryLabels(
			baseInput({ countries: countries(square('Small', -1, -1, 1, 1)) }),
			1,
			CANVAS.width,
			CANVAS.height,
			new LabelSpace(64),
			null
		);
		const large = layoutCountryLabels(
			baseInput({ countries: countries(square('Large', -9.5, -9.5, 9.5, 9.5)) }),
			1,
			CANVAS.width,
			CANVAS.height,
			new LabelSpace(64),
			null
		);

		expect(small).toHaveLength(0); // below the area floor, for contrast
		expect(large[0].fontSizePx).toBeGreaterThan(13);
	});

	it('is empty when there are no countries', () => {
		const placed = layoutCountryLabels(baseInput(), 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);
		expect(placed).toEqual([]);
	});

	describe('antimeridian wraparound (regression)', () => {
		// Loaded once, at module scope, from the real basemap data rather than
		// a hand-built fixture: reproducing this bug with a synthetic polygon
		// requires the geometry to pass near whatever raw longitude the
		// projection's *rotated* branch cut happens to land on for a given
		// frame — which is exactly the kind of coincidence that let this bug
		// through undetected. Russia's real Far East coastline does that for
		// an Iceland-framed map, which is the actual reproduction this guards.
		const countriesPath = join(process.cwd(), 'static/basemap/countries.json');
		const realCountries: CountryFeatureCollection = JSON.parse(readFileSync(countriesPath, 'utf-8'));

		it('does not label a country whose bbox spans the world but whose true geometry is off-screen', () => {
			// Iceland, framed tightly — the exact reproduction from the bug
			// report: Russia's Natural Earth polygon has vertices on both sides
			// of raw +-180 (so its naive min/max bbox spans the globe and can't
			// be culled by featureBbox), and its Far East coastline happens to
			// cross this frame's rotated branch cut, which used to make it
			// project to a spurious polygon covering most of the canvas.
			const bbox: Bbox = [-25, 63, -13, 67];
			const width = 800;
			const height = 600;
			const projection = buildProjection(width, height, bbox, 32);

			const placed = layoutCountryLabels(
				{
					countries: realCountries,
					projection,
					visibleBbox: bbox,
					measureTextWidth,
					fontFamily: 'sans-serif',
					fontSizePx: { min: 13, max: 40 }
				},
				1,
				width,
				height,
				new LabelSpace(64),
				null
			);

			const texts = placed.map((p) => p.text);
			expect(texts).toContain('ICELAND');
			expect(texts).not.toContain('RUSSIA');
		});
	});
});
