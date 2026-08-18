import { describe, expect, it } from 'vitest';
import { decodeVectorTile, type MvtSource } from './decode';

type Props = Record<string, number | string | boolean>;

function fakeLayer(rows: { properties: Props; geometry: GeoJSON.Geometry }[]) {
	return {
		length: rows.length,
		feature(i: number) {
			const row = rows[i];
			return {
				properties: row.properties,
				toGeoJSON: (): GeoJSON.Feature => ({ type: 'Feature', properties: row.properties, geometry: row.geometry })
			};
		}
	};
}

const point = (lon: number, lat: number): GeoJSON.Point => ({ type: 'Point', coordinates: [lon, lat] });
const line: GeoJSON.LineString = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

const coord = { z: 10, x: 5, y: 5 };

describe('decodeVectorTile', () => {
	it('keeps water features except swimming pools', () => {
		const tile: MvtSource = {
			layers: {
				water: fakeLayer([
					{ properties: { class: 'lake' }, geometry: polygon },
					{ properties: { class: 'ocean' }, geometry: polygon },
					{ properties: { class: 'swimming_pool' }, geometry: polygon }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.water).toHaveLength(2);
	});

	it('keeps only river/canal/stream waterways, dropping drain and ditch', () => {
		const tile: MvtSource = {
			layers: {
				waterway: fakeLayer([
					{ properties: { class: 'river' }, geometry: line },
					{ properties: { class: 'stream' }, geometry: line },
					{ properties: { class: 'drain' }, geometry: line },
					{ properties: { class: 'ditch' }, geometry: line }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.waterways).toHaveLength(2);
	});

	it('combines matching landuse and landcover classes into urban, dropping unlisted classes', () => {
		const tile: MvtSource = {
			layers: {
				landuse: fakeLayer([
					{ properties: { class: 'residential' }, geometry: polygon },
					{ properties: { class: 'military' }, geometry: polygon }
				]),
				landcover: fakeLayer([
					{ properties: { class: 'wood' }, geometry: polygon },
					{ properties: { class: 'ice' }, geometry: polygon }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.urban).toHaveLength(2);
	});

	it('splits boundary features into admin0 (level 2) and admin1 (level 4)', () => {
		const tile: MvtSource = {
			layers: {
				boundary: fakeLayer([
					{ properties: { admin_level: 2 }, geometry: line },
					{ properties: { admin_level: 4 }, geometry: line },
					{ properties: { admin_level: 6 }, geometry: line }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.admin0).toHaveLength(1);
		expect(result.admin1).toHaveLength(1);
	});

	it('keeps only city/town/village/hamlet places and normalizes name/rank', () => {
		const tile: MvtSource = {
			layers: {
				place: fakeLayer([
					{ properties: { class: 'city', name: 'Berlin', rank: 1 }, geometry: point(13.4, 52.5) },
					{ properties: { class: 'suburb', name: 'Mitte', rank: 3 }, geometry: point(13.4, 52.52) },
					{ properties: { class: 'hamlet', name: 'Nowhere', rank: 8 }, geometry: point(13.5, 52.6) }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.places).toHaveLength(2);
		expect(result.places[0].properties).toEqual({ name: 'Berlin', names: {}, rank: 1, size: 0 });
	});

	it('derives size from class, refined by rank within the class', () => {
		const tile: MvtSource = {
			layers: {
				place: fakeLayer([
					{ properties: { class: 'city', name: 'Big City', rank: 1 }, geometry: point(0, 0) },
					{ properties: { class: 'city', name: 'Small City', rank: 20 }, geometry: point(0, 0) },
					{ properties: { class: 'town', name: 'A Town', rank: 12 }, geometry: point(0, 0) },
					{ properties: { class: 'village', name: 'A Village', rank: 12 }, geometry: point(0, 0) },
					{ properties: { class: 'hamlet', name: 'A Hamlet', rank: 12 }, geometry: point(0, 0) }
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		const sizeOf = (name: string) => result.places.find((f) => f.properties.name === name)!.properties.size;

		expect(sizeOf('Big City')).toBeLessThan(sizeOf('Small City'));
		expect(sizeOf('Small City')).toBeLessThan(sizeOf('A Town'));
		expect(sizeOf('A Town')).toBeLessThan(sizeOf('A Village'));
		expect(sizeOf('A Village')).toBeLessThan(sizeOf('A Hamlet'));
	});

	it('pulls out per-language names for SUPPORTED_LANGUAGES only', () => {
		const tile: MvtSource = {
			layers: {
				place: fakeLayer([
					{
						properties: {
							class: 'city',
							name: 'München',
							'name:en': 'Munich',
							'name:de': 'München',
							'name:xx': 'should be ignored',
							rank: 1
						},
						geometry: point(11.575, 48.137)
					}
				])
			}
		};

		const result = decodeVectorTile(tile, coord);
		expect(result.places[0].properties).toEqual({
			name: 'München',
			names: { en: 'Munich', de: 'München' },
			rank: 1,
			size: 0
		});
	});

	it('returns empty arrays for layers absent from the tile', () => {
		const tile: MvtSource = { layers: {} };
		const result = decodeVectorTile(tile, coord);

		expect(result).toEqual({
			water: [],
			waterways: [],
			urban: [],
			parks: [],
			admin0: [],
			admin1: [],
			places: []
		});
	});
});
