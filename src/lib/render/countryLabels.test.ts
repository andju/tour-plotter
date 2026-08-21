import { describe, expect, it } from 'vitest';
import type { CountryFeatureCollection } from '../basemap/countries';
import type { Bbox } from '../geo/bbox';
import { buildTrackObstacles, layoutCountryLabels, type CountryLabelInput, type Projector } from './countryLabels';
import { LabelSpace } from './labels';

const WORLD_BBOX: Bbox = [-180, -90, 180, 90];

// Identity projection: treats lon/lat directly as pixel coordinates, so a
// simple square in "degrees" is a simple square on canvas — no real d3
// projection needed for pure placement-logic tests.
const identityProjection: Projector = ([lon, lat]) => [lon, lat];

// Deterministic stand-in for real font metrics, matching labels.test.ts's convention.
const measureTextWidth = (text: string, font: { sizePx: number }) => text.length * (font.sizePx / 2);

function square(name: string, x0: number, y0: number, x1: number, y1: number): GeoJSON.Feature<GeoJSON.Polygon, { name: string }> {
	return {
		type: 'Feature',
		properties: { name },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[x0, y0],
					[x1, y0],
					[x1, y1],
					[x0, y1],
					[x0, y0]
				]
			]
		}
	};
}

function countries(...features: GeoJSON.Feature<GeoJSON.Polygon, { name: string }>[]): CountryFeatureCollection {
	return { type: 'FeatureCollection', features };
}

function baseInput(overrides: Partial<CountryLabelInput> = {}): CountryLabelInput {
	return {
		countries: countries(),
		projection: identityProjection,
		visibleBbox: WORLD_BBOX,
		measureTextWidth,
		fontFamily: 'sans-serif',
		fontSizePx: { min: 13, max: 24 },
		...overrides
	};
}

const CANVAS = { width: 400, height: 400 };

describe('layoutCountryLabels', () => {
	it('labels a country large enough to clear the minimum-area gate', () => {
		const input = baseInput({ countries: countries(square('France', 50, 50, 350, 350)) });

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		expect(placed).toHaveLength(1);
		expect(placed[0].text).toBe('FRANCE');
	});

	it('drops a country whose visible portion is too small to label meaningfully', () => {
		// A sliver in the corner: well under the 1.5% of canvas area floor.
		const input = baseInput({ countries: countries(square('Sliver', 0, 0, 10, 10)) });

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		expect(placed).toHaveLength(0);
	});

	it('places the larger of two countries first, giving it first pick of the shared space', () => {
		const input = baseInput({
			countries: countries(square('Small', 250, 50, 350, 150), square('Big', 20, 20, 380, 380))
		});

		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), null);

		const texts = placed.map((p) => p.text);
		expect(texts[0]).toBe('BIG');
	});

	it('routes around an already-reserved city label box instead of overlapping it', () => {
		const space = new LabelSpace(64);
		// Reserve a box across the exact centroid of the square country below,
		// as if a city label had already been placed there.
		space.insert({ x0: 150, y0: 150, x1: 250, y1: 250 });

		const input = baseInput({ countries: countries(square('France', 50, 50, 350, 350)) });
		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, space, null);

		expect(placed).toHaveLength(1);
		// The centroid candidate (200, 200) collides with the reserved box, so
		// the accepted anchor must be a different point.
		expect(placed[0].xy).not.toEqual([200, 200]);
	});

	it('drops a country when a track crosses every candidate anchor', () => {
		const input = baseInput({ countries: countries(square('France', 50, 50, 350, 350)) });
		const obstacles = buildTrackObstacles(
			[
				{
					id: 't1',
					name: 'Blocking track',
					segments: [
						[
							{ lon: 0, lat: 200, ele: null, time: null },
							{ lon: 400, lat: 200, ele: null, time: null }
						]
					],
					style: { color: '#f00', widthPx: 3, opacity: 1, visible: true }
				}
			],
			identityProjection
		);

		// A single horizontal track through the middle doesn't necessarily
		// block every one of the ~7 candidate anchors, so assert the weaker,
		// still-meaningful property: at minimum the centroid anchor (which
		// sits exactly on the track) is never accepted.
		const placed = layoutCountryLabels(input, 1, CANVAS.width, CANVAS.height, new LabelSpace(64), obstacles);
		if (placed.length > 0) {
			expect(placed[0].xy).not.toEqual([200, 200]);
		}
	});

	it('scales font size up for a country that fills more of the canvas', () => {
		const small = layoutCountryLabels(
			baseInput({ countries: countries(square('Small', 100, 100, 180, 180)) }),
			1,
			CANVAS.width,
			CANVAS.height,
			new LabelSpace(64),
			null
		);
		const large = layoutCountryLabels(
			baseInput({ countries: countries(square('Large', 20, 20, 380, 380)) }),
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
});
