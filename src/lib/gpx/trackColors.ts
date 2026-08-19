export interface TrackColor {
	name: string;
	hex: string;
}

/** Material Design 2 palette, one shade per hue, ordered by hue for scanning. */
export const TRACK_COLORS: TrackColor[] = [
	{ name: 'Red 700', hex: '#d32f2f' },
	{ name: 'Deep Orange 700', hex: '#e64a19' },
	{ name: 'Orange 700', hex: '#f57c00' },
	{ name: 'Amber 700', hex: '#ffa000' },
	{ name: 'Yellow 700', hex: '#fbc02d' },
	{ name: 'Lime 800', hex: '#9e9d24' },
	{ name: 'Light Green 700', hex: '#689f38' },
	{ name: 'Green 700', hex: '#388e3c' },
	{ name: 'Teal 700', hex: '#00796b' },
	{ name: 'Cyan 700', hex: '#0097a7' },
	{ name: 'Light Blue 700', hex: '#0288d1' },
	{ name: 'Blue 700', hex: '#1976d2' },
	{ name: 'Indigo 700', hex: '#303f9f' },
	{ name: 'Deep Purple 700', hex: '#512da8' },
	{ name: 'Purple 700', hex: '#7b1fa2' },
	{ name: 'Pink 500', hex: '#e91e63' },
	{ name: 'Brown 700', hex: '#5d4037' },
	{ name: 'Blue Grey 800', hex: '#37474f' },
	{ name: 'Grey 900', hex: '#212121' },
	{ name: 'Grey 500', hex: '#9e9e9e' }
];

/**
 * Cycled by track index. Material hues picked to stay distinguishable under
 * common color vision deficiencies (the intent the previous Okabe-Ito
 * palette served).
 */
export const DEFAULT_TRACK_COLORS: string[] = [
	'#d32f2f', // Red 700
	'#1976d2', // Blue 700
	'#ffa000', // Amber 700
	'#00796b', // Teal 700
	'#7b1fa2', // Purple 700
	'#5d4037', // Brown 700
	'#e91e63', // Pink 500
	'#37474f' // Blue Grey 800
];

const HEX_3 = /^#?([0-9a-f]{3})$/i;
const HEX_6 = /^#?([0-9a-f]{6})$/i;

/**
 * Accepts `#RGB`, `#RRGGBB`, with or without the leading `#`, any case.
 * Returns the canonical `#rrggbb` form, or null if the input isn't a valid hex color.
 */
export function normalizeHex(input: string): string | null {
	const trimmed = input.trim();

	const short = trimmed.match(HEX_3);
	if (short) {
		const [r, g, b] = short[1].toLowerCase().split('');
		return `#${r}${r}${g}${g}${b}${b}`;
	}

	const long = trimmed.match(HEX_6);
	if (long) return `#${long[1].toLowerCase()}`;

	return null;
}
