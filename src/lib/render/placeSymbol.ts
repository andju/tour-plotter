import type { PlaceCapital } from '../basemap/placeCapital';
import { sizeClass } from '../basemap/placeSize';

export type PlaceSymbolShape = 'circle' | 'square' | 'star';

export interface PlaceSymbol {
	shape: PlaceSymbolShape;
	/** Circle: draw radius. Square: half-side. Unused (0) for a star, whose geometry is `starPoints`. */
	drawRadiusPx: number;
	/** Star only, absolute pixel points (a 10-point outline alternating outer/inner vertices), first vertex pointing up. Empty for circle/square. */
	starPoints: [number, number][];
	/** Effective radius to keep a label's box clear of — the circle's radius, the square's half-diagonal, or the star's circumradius. Same role for every shape, unlike `drawRadiusPx`. */
	anchorRadiusPx: number;
	fontSizePx: number;
}

/** A square's half-side, sized so its area roughly matches the circle it replaces rather than reading heavier. */
const SQUARE_HALF_SIDE_RATIO = 0.9;
/** A star's circumradius relative to the class radius it replaces, tuned to match the square capital's footprint (`SQUARE_HALF_SIDE_RATIO * sqrt(2) ≈ 1.27r`) rather than its fill area — a star's points reaching a bit further than its own ink is what reads as proportionate to a circle, not oversized. Chasing area-parity instead would require a much larger circumradius (~1.7r), since a star's fill is only ~1.12*k*R² for a circumscribing circle of area π*R² — that's what made earlier tuning still look disproportionate. */
const STAR_CIRCUMRADIUS_RATIO = 1.3;
/** Classic 5-point star inner/outer radius ratio (1/phi^2). */
const STAR_INNER_RATIO = 0.382;

function starPoints(xy: [number, number], circumradius: number): [number, number][] {
	const innerRadius = circumradius * STAR_INNER_RATIO;
	const points: [number, number][] = [];
	for (let i = 0; i < 10; i++) {
		const angle = -Math.PI / 2 + (i * Math.PI) / 5;
		const r = i % 2 === 0 ? circumradius : innerRadius;
		points.push([xy[0] + r * Math.cos(angle), xy[1] + r * Math.sin(angle)]);
	}
	return points;
}

/**
 * The shape and size a place draws at: circle for an ordinary place, square
 * for a first-order (state/province) capital, star for a national capital —
 * see basemap/placeCapital.ts. Size is graduated into a handful of classes
 * (basemap/placeSize.ts's `sizeClass`) rather than tapering continuously,
 * since readers can only reliably tell a few point sizes apart.
 *
 * `radiiPx`/`fontSizesPx` are the per-class arrays from SceneStyle
 * (`referenceCitySymbolRadiusPx`/`referenceFontSizePx.cityTiers`), already
 * scaled to the output resolution by the caller — this function is plain
 * geometry, not styling, so it takes the numbers rather than the whole
 * SceneStyle.
 */
export function placeSymbol(
	xy: [number, number],
	size: number,
	capital: PlaceCapital | undefined,
	radiiPx: number[],
	fontSizesPx: number[]
): PlaceSymbol {
	const cls = sizeClass(size);
	const r = radiiPx[cls];
	const fontSizePx = fontSizesPx[cls];

	if (capital === 'country') {
		const circumradius = r * STAR_CIRCUMRADIUS_RATIO;
		return {
			shape: 'star',
			drawRadiusPx: 0,
			starPoints: starPoints(xy, circumradius),
			anchorRadiusPx: circumradius,
			fontSizePx
		};
	}

	if (capital === 'region') {
		const halfSide = r * SQUARE_HALF_SIDE_RATIO;
		return {
			shape: 'square',
			drawRadiusPx: halfSide,
			starPoints: [],
			anchorRadiusPx: halfSide * Math.SQRT2,
			fontSizePx
		};
	}

	return {
		shape: 'circle',
		drawRadiusPx: r,
		starPoints: [],
		anchorRadiusPx: r,
		fontSizePx
	};
}
