import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate } from './labels';

// Deterministic stand-in for real font metrics: 6px per character, scaled by font size.
const measure = (text: string, fontSizePx: number) => text.length * (fontSizePx / 2);
const FONT_SIZE = 12;
const CANVAS = { width: 400, height: 400 };

describe('placeLabels', () => {
	it('places all candidates when none overlap', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'a', xy: [10, 10], text: 'Alpha', priority: 0, fontSizePx: FONT_SIZE },
			{ id: 'b', xy: [10, 200], text: 'Beta', priority: 1, fontSizePx: FONT_SIZE },
			{ id: 'c', xy: [10, 350], text: 'Gamma', priority: 2, fontSizePx: FONT_SIZE }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id)).toEqual(['a', 'b', 'c']);
	});

	it('drops a lower-priority label that would overlap a higher-priority one', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'major', xy: [10, 10], text: 'Major City', priority: 0, fontSizePx: FONT_SIZE },
			{ id: 'minor', xy: [12, 12], text: 'Minor Town', priority: 5, fontSizePx: FONT_SIZE } // nearly on top of 'major'
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id)).toEqual(['major']);
	});

	it('keeps a lower-priority label once it no longer overlaps', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'major', xy: [10, 10], text: 'Major City', priority: 0, fontSizePx: FONT_SIZE },
			{ id: 'far', xy: [10, 300], text: 'Far Town', priority: 5, fontSizePx: FONT_SIZE }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id).sort()).toEqual(['far', 'major']);
	});

	it('processes priority order regardless of input order', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'low-priority-first', xy: [10, 10], text: 'Low', priority: 5, fontSizePx: FONT_SIZE },
			{ id: 'high-priority-second', xy: [12, 12], text: 'High', priority: 0, fontSizePx: FONT_SIZE }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		// The high-priority one should win the overlap regardless of array order.
		expect(placed.map((p) => p.id)).toEqual(['high-priority-second']);
	});

	it('drops a label that would fall off the canvas edge', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'edge', xy: [395, 10], text: 'Overflowing Label', priority: 0, fontSizePx: FONT_SIZE }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed).toHaveLength(0);
	});

	it('offsets the text position from the anchor dot', () => {
		const candidates: LabelCandidate[] = [{ id: 'a', xy: [50, 50], text: 'City', priority: 0, fontSizePx: FONT_SIZE }];
		const [placed] = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.dotXy).toEqual([50, 50]);
		expect(placed.textXy[0]).toBeGreaterThan(50);
		expect(placed.textXy[1]).toBe(50);
	});

	it('carries each candidate\'s own fontSizePx through to the placed label', () => {
		const candidates: LabelCandidate[] = [{ id: 'a', xy: [50, 50], text: 'City', priority: 0, fontSizePx: 22 }];
		const [placed] = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.fontSizePx).toBe(22);
	});

	it('a large-font candidate placed first can displace a smaller one it overlaps', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'big', xy: [10, 50], text: 'Big', priority: 0, fontSizePx: 40 },
			{ id: 'small', xy: [10, 70], text: 'Small', priority: 1, fontSizePx: 8 } // inside big's larger box
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id)).toEqual(['big']);
	});

	it('offsets the label past the marker footprint, not just the anchor point', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'a', xy: [50, 50], text: 'City', priority: 0, fontSizePx: FONT_SIZE, anchorRadiusPx: 30 }
		];
		const [placed] = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.textXy[0]).toBeGreaterThanOrEqual(50 + 30);
	});

	it('drops a lower-priority label that would land on a higher-priority place\'s marker', () => {
		const candidates: LabelCandidate[] = [
			{ id: 'big', xy: [10, 50], text: 'Big', priority: 0, fontSizePx: FONT_SIZE, anchorRadiusPx: 40 },
			// Anchored far from 'big', but its own right-offset label box lands on big's oversized marker footprint.
			{ id: 'other', xy: [60, 50], text: 'Other', priority: 1, fontSizePx: FONT_SIZE }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id)).toEqual(['big']);
	});

	it('does not let a lower-priority place\'s marker block a higher-priority place\'s own label', () => {
		// A tiny, unimportant marker sitting exactly where the important place's label would go —
		// e.g. a capital's own suburb. Since it's processed after the important place, its
		// footprint isn't reserved yet when the important place's label is placed.
		const candidates: LabelCandidate[] = [
			{ id: 'capital', xy: [10, 50], text: 'Capital', priority: 0, fontSizePx: FONT_SIZE, anchorRadiusPx: 5 },
			{ id: 'suburb', xy: [30, 50], text: '', priority: 99, fontSizePx: FONT_SIZE, anchorRadiusPx: 20 }
		];

		const placed = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(placed.map((p) => p.id)).toContain('capital');
	});
});
