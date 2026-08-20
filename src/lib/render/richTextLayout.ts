import type { RichLine, TextRun } from './markdown';
import type { Font } from './renderer';

/**
 * Line-height multiplier applied to a reference font size to get the height
 * of one line of text plus a little breathing space above/below it. Shared
 * with scene.ts's title background box, which this module's output feeds.
 */
export const TEXT_BAND_LINE_HEIGHT = 1.5;

/** A blank source line renders as this fraction of a body line's height, not a full empty line. */
const BLANK_LINE_FRACTION = 0.5;

/** Font-size multiplier per heading level (1-6); body text (heading 0) is 1. */
const HEADING_SCALE: Record<number, number> = { 1: 1.35, 2: 1.2, 3: 1.1, 4: 1.05, 5: 1, 6: 1 };

export interface LaidOutRun extends TextRun {
	font: Font;
	/** Offset from the line's own left edge. */
	xPx: number;
	widthPx: number;
}

export interface LaidOutLine {
	runs: LaidOutRun[];
	widthPx: number;
	heightPx: number;
	/** This line's vertical centre, relative to the block's top. */
	centerYPx: number;
}

export interface LaidOutBlock {
	lines: LaidOutLine[];
	widthPx: number;
	heightPx: number;
}

export interface RichTextLayoutOptions {
	baseFontSizePx: number;
	fontFamily: string;
	monoFontFamily: string;
}

/**
 * Resolves each parsed line/run to a concrete Font, an x offset within its
 * line, and stacks lines top to bottom. `measure` is injected rather than
 * imported, like labels.ts's placement algorithm — jsdom (unit tests) has no
 * Canvas 2D support, so the real measurer stays browser-only while this
 * layout logic is unit-testable with a deterministic stand-in.
 */
export function layoutRichText(
	lines: RichLine[],
	opts: RichTextLayoutOptions,
	measure: (text: string, font: Font) => number
): LaidOutBlock {
	const laidOutLines: LaidOutLine[] = [];
	let y = 0;
	let blockWidth = 0;

	for (const line of lines) {
		const isBlank = line.runs.length === 0 && !line.bullet && line.heading === 0;
		if (isBlank) {
			const heightPx = opts.baseFontSizePx * TEXT_BAND_LINE_HEIGHT * BLANK_LINE_FRACTION;
			laidOutLines.push({ runs: [], widthPx: 0, heightPx, centerYPx: y + heightPx / 2 });
			y += heightPx;
			continue;
		}

		const scale = HEADING_SCALE[line.heading] ?? 1;
		const fontSizePx = opts.baseFontSizePx * scale;
		const headingBold = line.heading > 0;

		const runs: TextRun[] = line.bullet ? [{ text: '• ', bold: false, italic: false, strike: false, code: false }, ...line.runs] : line.runs;

		let x = 0;
		const laidOutRuns: LaidOutRun[] = runs.map((run) => {
			const font: Font = {
				sizePx: fontSizePx,
				family: run.code ? opts.monoFontFamily : opts.fontFamily,
				weight: run.bold || headingBold ? 'bold' : 'normal',
				style: run.italic ? 'italic' : 'normal'
			};
			const widthPx = measure(run.text, font);
			const laidOut: LaidOutRun = { ...run, font, xPx: x, widthPx };
			x += widthPx;
			return laidOut;
		});

		const heightPx = fontSizePx * TEXT_BAND_LINE_HEIGHT;
		laidOutLines.push({ runs: laidOutRuns, widthPx: x, heightPx, centerYPx: y + heightPx / 2 });
		blockWidth = Math.max(blockWidth, x);
		y += heightPx;
	}

	return { lines: laidOutLines, widthPx: blockWidth, heightPx: y };
}
