import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate, type PlacedLabel } from './labels';

// Deterministic stand-in for real font metrics: 6px per character, scaled by font size.
const measure = (text: string, fontSizePx: number) => text.length * (fontSizePx / 2);
const FONT_SIZE = 12;
const CANVAS = { width: 400, height: 400 };

// mulberry32 — small, seedable PRNG so randomised tests are deterministic across runs.
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeCandidates(count: number, rand: () => number, canvas: { width: number; height: number }): LabelCandidate[] {
	return Array.from({ length: count }, (_, i) => {
		const hasMarker = rand() < 0.3;
		return {
			id: `c${i}`,
			xy: [rand() * canvas.width, rand() * canvas.height] as [number, number],
			text: 'Place'.slice(0, 1 + Math.floor(rand() * 5)),
			priority: Math.floor(rand() * count),
			fontSizePx: 8 + rand() * 10,
			...(hasMarker ? { anchorRadiusPx: rand() * 6 } : {})
		};
	});
}

/**
 * Pre-grid reference implementation: the same algorithm as `placeLabels`,
 * but with the reserved-box lookup as a brute-force `Array.some` scan
 * instead of the spatial grid. Used only to verify the grid version stays
 * behaviourally identical.
 */
function bruteForcePlaceLabels(
	candidates: LabelCandidate[],
	measureWidth: (text: string, fontSizePx: number) => number,
	canvasWidth: number,
	canvasHeight: number
): PlacedLabel[] {
	const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
	const placed: PlacedLabel[] = [];
	const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
	const overlaps = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
		a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

	for (const candidate of sorted) {
		const { fontSizePx } = candidate;
		const anchorRadiusPx = candidate.anchorRadiusPx ?? 0;
		if (anchorRadiusPx) {
			boxes.push({
				x0: candidate.xy[0] - anchorRadiusPx,
				y0: candidate.xy[1] - anchorRadiusPx,
				x1: candidate.xy[0] + anchorRadiusPx,
				y1: candidate.xy[1] + anchorRadiusPx
			});
		}

		const offsetPx = anchorRadiusPx + fontSizePx * 0.5;
		const paddingPx = fontSizePx * 0.15;
		const textWidth = measureWidth(candidate.text, fontSizePx);
		const textXy: [number, number] = [candidate.xy[0] + offsetPx, candidate.xy[1]];
		const box = {
			x0: textXy[0] - paddingPx,
			y0: textXy[1] - fontSizePx / 2 - paddingPx,
			x1: textXy[0] + textWidth + paddingPx,
			y1: textXy[1] + fontSizePx / 2 + paddingPx
		};

		if (box.x0 < 0 || box.y0 < 0 || box.x1 > canvasWidth || box.y1 > canvasHeight) continue;
		if (boxes.some((existing) => overlaps(existing, box))) continue;

		boxes.push(box);
		placed.push({ id: candidate.id, dotXy: candidate.xy, text: candidate.text, textXy, fontSizePx });
	}

	return placed;
}

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

	it('matches a brute-force reference implementation for a randomised candidate set', () => {
		const rand = seededRandom(42);
		const candidates = makeCandidates(400, rand, CANVAS);

		const gridResult = placeLabels(candidates, measure, CANVAS.width, CANVAS.height);
		const bruteForceResult = bruteForcePlaceLabels(candidates, measure, CANVAS.width, CANVAS.height);

		expect(gridResult).toEqual(bruteForceResult);
	});

	it('completes placement over thousands of candidates (regression tripwire for the O(n^2) scan)', () => {
		const rand = seededRandom(7);
		const bigCanvas = { width: 4000, height: 4000 };
		const candidates = makeCandidates(3000, rand, bigCanvas);

		const start = performance.now();
		const placed = placeLabels(candidates, measure, bigCanvas.width, bigCanvas.height);
		const duration = performance.now() - start;

		expect(placed.length).toBeGreaterThan(0);
		// Generous bound, not a tight perf assertion — just a tripwire against reintroducing O(n^2).
		expect(duration).toBeLessThan(5000);
	});
});
