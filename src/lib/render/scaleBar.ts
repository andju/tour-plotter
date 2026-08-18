import { geoDistance, type GeoProjection } from 'd3-geo';

const EARTH_RADIUS_KM = 6371;
/** Candidate round distances, as a mantissa cycling through powers of ten. */
const ROUND_MANTISSAS = [1, 2, 5];
/** A scale bar longer than this fraction of the output width is rejected. */
const MAX_WIDTH_FRACTION = 0.2;

export interface ScaleBar {
	widthPx: number;
	label: string;
}

/**
 * Picks the largest "round" ground distance (1/2/5 * 10^n km or m) whose
 * projected length fits within MAX_WIDTH_FRACTION of the output width, and
 * returns the pixel width of a bar spanning exactly that distance.
 *
 * Ground distance is measured via projection.invert at the bar's own
 * baseline (bottom-left, inset by marginPx) rather than assumed from the
 * projection's linear scale, because Mercator's scale varies with latitude
 * — a bar measured this way stays accurate away from the equator.
 */
export function computeScaleBar(
	projection: GeoProjection,
	outputWidth: number,
	outputHeight: number,
	marginPx: number
): ScaleBar | null {
	const invert = projection.invert;
	if (!invert) return null;

	const y = outputHeight - marginPx;
	const x0 = marginPx;
	const originLonLat = invert([x0, y]);
	if (!originLonLat) return null;

	// Meters of ground distance per pixel at this baseline, measured with a
	// short probe segment near the origin rather than at the full max width,
	// since Mercator's scale can shift noticeably across a wide frame.
	const probePx = 100;
	const probeLonLat = invert([x0 + probePx, y]);
	if (!probeLonLat) return null;
	const metersPerPx = (geoDistance(originLonLat, probeLonLat) * EARTH_RADIUS_KM * 1000) / probePx;
	if (!Number.isFinite(metersPerPx) || metersPerPx <= 0) return null;

	const maxWidthPx = outputWidth * MAX_WIDTH_FRACTION;
	const maxMeters = maxWidthPx * metersPerPx;
	if (maxMeters <= 0) return null;

	const roundMeters = largestRoundDistance(maxMeters);
	if (roundMeters === null) return null;

	return {
		widthPx: roundMeters / metersPerPx,
		label: formatDistance(roundMeters)
	};
}

/** Largest value of the form {1,2,5} * 10^n (n integer) that is <= maxMeters. */
function largestRoundDistance(maxMeters: number): number | null {
	if (maxMeters < 1) return null;
	const magnitude = Math.floor(Math.log10(maxMeters));
	// Search from one magnitude above down to one below, in case rounding at
	// the boundary skips the largest valid candidate.
	for (let exp = magnitude + 1; exp >= magnitude - 1; exp--) {
		for (let i = ROUND_MANTISSAS.length - 1; i >= 0; i--) {
			const candidate = ROUND_MANTISSAS[i] * 10 ** exp;
			if (candidate <= maxMeters) return candidate;
		}
	}
	return null;
}

function formatDistance(meters: number): string {
	if (meters >= 1000) return `${meters / 1000} km`;
	return `${meters} m`;
}
