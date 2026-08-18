export interface LabelCandidate {
	id: string;
	/** Anchor point in pixel space (already projected). */
	xy: [number, number];
	text: string;
	/** Lower places first — see PlaceProperties.size/.rank for how this is derived. */
	priority: number;
	/** Already scaled to the output resolution, like every other length in SceneStyle. */
	fontSizePx: number;
}

export interface PlacedLabel {
	id: string;
	dotXy: [number, number];
	text: string;
	textXy: [number, number];
	fontSizePx: number;
}

/**
 * Greedy label placement: most important candidates first, each one kept
 * only if its box doesn't overlap an already-placed label and stays on
 * canvas. Adequate at this app's scale — a basemap showing only "major
 * cities" is a few dozen candidates at most, not thousands.
 *
 * Since candidates are processed most-important-first, a large place's label
 * is placed (and its box reserved) before a smaller, lower-priority
 * neighbour is even considered — so varying `fontSizePx` per candidate
 * doesn't need any special-casing here, it just changes whose box is
 * reserved first.
 *
 * Offset and padding are derived from each candidate's own fontSizePx
 * (already scaled to the output resolution by the caller) rather than fixed
 * pixel constants, so label spacing scales with everything else instead of
 * looking proportionally cramped at large export sizes.
 */
export function placeLabels(
	candidates: LabelCandidate[],
	measureWidth: (text: string, fontSizePx: number) => number,
	canvasWidth: number,
	canvasHeight: number
): PlacedLabel[] {
	const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
	const placed: PlacedLabel[] = [];
	const boxes: Box[] = [];

	for (const candidate of sorted) {
		const { fontSizePx } = candidate;
		const offsetPx = fontSizePx * 0.5;
		const paddingPx = fontSizePx * 0.15;
		const textWidth = measureWidth(candidate.text, fontSizePx);
		const textXy: [number, number] = [candidate.xy[0] + offsetPx, candidate.xy[1]];
		const box: Box = {
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

interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function overlaps(a: Box, b: Box): boolean {
	return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}
