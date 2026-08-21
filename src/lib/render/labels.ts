export interface LabelCandidate {
	id: string;
	/** Anchor point in pixel space (already projected). */
	xy: [number, number];
	text: string;
	/** Lower places first — see PlaceProperties.size/.rank for how this is derived. */
	priority: number;
	/** Already scaled to the output resolution, like every other length in SceneStyle. */
	fontSizePx: number;
	/** The marker's own footprint at `xy` (see placeSymbol.ts's `anchorRadiusPx`) — reserved so no label is placed across another place's symbol, and the label offset clears it. 0 (a point marker) by default. */
	anchorRadiusPx?: number;
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
 * canvas. Reserved boxes are bucketed into a uniform spatial grid (see
 * `ReservedBoxGrid`) so a new candidate is only checked against boxes near
 * it, not every box placed so far — this app's city-size slider can push
 * "all places" candidate counts into the thousands, where a full scan per
 * candidate becomes millions of rectangle comparisons.
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
 *
 * Each candidate's own marker footprint (`anchorRadiusPx`) is reserved as a
 * box at the same point it's reached in priority order — right before that
 * candidate's own label is attempted, not for every candidate up front. A
 * candidate's offset already clears its own just-reserved footprint (see
 * below), so this never blocks a place from labelling itself; reserving
 * every footprint up front, before priority order is applied, would instead
 * let a cluster of minor, low-priority places (e.g. a capital's own nearby
 * suburbs) silently block the capital's own label.
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
	const grid = new ReservedBoxGrid(gridCellSize(sorted));

	for (const candidate of sorted) {
		const { fontSizePx } = candidate;
		const anchorRadiusPx = candidate.anchorRadiusPx ?? 0;
		if (anchorRadiusPx) {
			const marker = markerBox(candidate.xy, anchorRadiusPx);
			grid.insert(marker, boxes.push(marker) - 1);
		}

		const offsetPx = anchorRadiusPx + fontSizePx * 0.5;
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
		if (grid.query(box).some((index) => overlaps(boxes[index], box))) continue;

		grid.insert(box, boxes.push(box) - 1);
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

function markerBox(xy: [number, number], anchorRadiusPx: number): Box {
	return { x0: xy[0] - anchorRadiusPx, y0: xy[1] - anchorRadiusPx, x1: xy[0] + anchorRadiusPx, y1: xy[1] + anchorRadiusPx };
}

/** A multiple of the median candidate font size — a proxy for typical box dimensions. */
function gridCellSize(candidates: LabelCandidate[]): number {
	if (candidates.length === 0) return 32;
	const sizes = [...candidates.map((c) => c.fontSizePx)].sort((a, b) => a - b);
	const mid = Math.floor(sizes.length / 2);
	const median = sizes.length % 2 === 0 ? (sizes[mid - 1] + sizes[mid]) / 2 : sizes[mid];
	return median * 8 || 32;
}

/**
 * Uniform grid over reserved boxes, keyed by cell coordinate. A box is
 * bucketed into every cell it overlaps (it may span more than one), and a
 * query returns the union of every box index sharing a cell with the query
 * box — a superset of the true overlaps, which callers narrow with `overlaps`.
 */
class ReservedBoxGrid {
	private readonly cellSize: number;
	private readonly cells = new Map<string, number[]>();

	constructor(cellSize: number) {
		this.cellSize = cellSize > 0 ? cellSize : 32;
	}

	insert(box: Box, index: number): void {
		for (const key of this.cellKeys(box)) {
			const bucket = this.cells.get(key);
			if (bucket) bucket.push(index);
			else this.cells.set(key, [index]);
		}
	}

	query(box: Box): number[] {
		const seen = new Set<number>();
		for (const key of this.cellKeys(box)) {
			const bucket = this.cells.get(key);
			if (!bucket) continue;
			for (const index of bucket) seen.add(index);
		}
		return [...seen];
	}

	private *cellKeys(box: Box): Generator<string> {
		const x0 = Math.floor(box.x0 / this.cellSize);
		const y0 = Math.floor(box.y0 / this.cellSize);
		const x1 = Math.floor(box.x1 / this.cellSize);
		const y1 = Math.floor(box.y1 / this.cellSize);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				yield `${cx},${cy}`;
			}
		}
	}
}
