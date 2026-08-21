import { describe, expect, it } from 'vitest';
import type { Bbox } from '../geo/bbox';
import { bboxIntersects, featureBbox } from './cull';

function polygonFeature(coordinates: [number, number][]): GeoJSON.Feature<GeoJSON.Polygon> {
	return {
		type: 'Feature',
		properties: {},
		geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
	};
}

describe('featureBbox', () => {
	// geoBounds is deliberately not used here — see cull.ts's header comment.
	it('computes a feature bbox from its raw coordinates', () => {
		const feature = polygonFeature([
			[10, 50],
			[12, 50],
			[12, 52],
			[10, 52]
		]);
		expect(featureBbox(feature)).toEqual([10, 50, 12, 52]);
	});

	it('memoises the result for the same feature object', () => {
		const feature = polygonFeature([
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1]
		]);
		const first = featureBbox(feature);
		const second = featureBbox(feature);
		expect(second).toBe(first);
	});

	it('computes the union bbox of a GeometryCollection', () => {
		const feature: GeoJSON.Feature<GeoJSON.GeometryCollection> = {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'GeometryCollection',
				geometries: [
					{ type: 'Point', coordinates: [10, 50] },
					{ type: 'Point', coordinates: [12, 52] }
				]
			}
		};
		const bbox = featureBbox(feature);
		expect(bbox).toEqual([10, 50, 12, 52]);
		expect(bboxIntersects(bbox, [0, 0, 20, 60])).toBe(true);
	});

	it('culls an empty GeometryCollection', () => {
		const feature: GeoJSON.Feature<GeoJSON.GeometryCollection> = {
			type: 'Feature',
			properties: {},
			geometry: { type: 'GeometryCollection', geometries: [] }
		};
		const bbox = featureBbox(feature);
		expect(bboxIntersects(bbox, [-180, -90, 180, 90])).toBe(false);
	});
});

describe('bboxIntersects', () => {
	it('detects overlapping non-wrapping bboxes', () => {
		const a: Bbox = [0, 0, 10, 10];
		const b: Bbox = [5, 5, 15, 15];
		expect(bboxIntersects(a, b)).toBe(true);
	});

	it('detects disjoint non-wrapping bboxes', () => {
		const a: Bbox = [0, 0, 10, 10];
		const b: Bbox = [20, 20, 30, 30];
		expect(bboxIntersects(a, b)).toBe(false);
	});

	it('keeps a feature bbox fully contained inside the viewport', () => {
		const feature: Bbox = [1, 1, 2, 2];
		const viewport: Bbox = [0, 0, 10, 10];
		expect(bboxIntersects(feature, viewport)).toBe(true);
	});

	it('drops a feature just outside the viewport', () => {
		const feature: Bbox = [11, 0, 12, 10];
		const viewport: Bbox = [0, 0, 10, 10];
		expect(bboxIntersects(feature, viewport)).toBe(false);
	});

	it('is disjoint on latitude alone even when longitude overlaps', () => {
		const a: Bbox = [0, 0, 10, 10];
		const b: Bbox = [0, 20, 10, 30];
		expect(bboxIntersects(a, b)).toBe(false);
	});

	it('handles a feature bbox that wraps the antimeridian and overlaps the viewport', () => {
		// A feature spanning 170..-170 (i.e. crossing +-180) — by convention
		// minLon > maxLon, matching geoBounds/Bbox's wrap representation.
		const wrapping: Bbox = [170, -10, -170, 10];
		const viewport: Bbox = [175, -5, 180, 5];
		expect(bboxIntersects(wrapping, viewport)).toBe(true);
	});

	it('handles a wrapping viewport against a non-wrapping feature on the far side', () => {
		const wrappingViewport: Bbox = [170, -10, -170, 10];
		const feature: Bbox = [-175, -5, -172, 5];
		expect(bboxIntersects(feature, wrappingViewport)).toBe(true);
	});

	it('drops a feature on the opposite side of the globe from a wrapping viewport', () => {
		const wrappingViewport: Bbox = [170, -10, -170, 10];
		const feature: Bbox = [0, -5, 10, 5];
		expect(bboxIntersects(feature, wrappingViewport)).toBe(false);
	});
});
