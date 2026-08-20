import { describe, expect, it } from 'vitest';
import type { RichLine, TextRun } from './markdown';
import { layoutRichText, TEXT_BAND_LINE_HEIGHT, type RichTextLayoutOptions } from './richTextLayout';

// Deterministic stand-in for real font metrics, like labels.test.ts's measure —
// half a reference-px per character, scaled by the run's own font size.
const measure = (text: string, font: { sizePx: number }) => text.length * font.sizePx * 0.5;

const OPTS: RichTextLayoutOptions = { baseFontSizePx: 10, fontFamily: 'sans', monoFontFamily: 'mono' };

function run(text: string, overrides: Partial<TextRun> = {}): TextRun {
	return { text, bold: false, italic: false, strike: false, code: false, ...overrides };
}

function line(runs: TextRun[], overrides: Partial<Omit<RichLine, 'runs'>> = {}): RichLine {
	return { runs, heading: 0, bullet: false, ...overrides };
}

describe('layoutRichText', () => {
	it('positions each run after the width of every run before it on the same line', () => {
		const block = layoutRichText([line([run('ab'), run('cd')])], OPTS, measure);

		expect(block.lines[0].runs[0]).toMatchObject({ xPx: 0, widthPx: 10 });
		expect(block.lines[0].runs[1]).toMatchObject({ xPx: 10, widthPx: 10 });
		expect(block.lines[0].widthPx).toBe(20);
	});

	it('sets the block width to the widest line, not the last one', () => {
		const block = layoutRichText([line([run('short')]), line([run('a much longer line')])], OPTS, measure);

		expect(block.widthPx).toBe(block.lines[1].widthPx);
		expect(block.widthPx).toBeGreaterThan(block.lines[0].widthPx);
	});

	it('sums line heights (plus blank-line spacing) into the block height', () => {
		const block = layoutRichText([line([run('a')]), line([run('b')])], OPTS, measure);

		expect(block.heightPx).toBe(block.lines[0].heightPx + block.lines[1].heightPx);
	});

	it('scales heading lines up and marks them bold, independent of run.bold', () => {
		const body = layoutRichText([line([run('x')])], OPTS, measure);
		const heading = layoutRichText([line([run('x')], { heading: 1 })], OPTS, measure);

		expect(heading.lines[0].runs[0].font.sizePx).toBeGreaterThan(body.lines[0].runs[0].font.sizePx);
		expect(heading.lines[0].runs[0].font.weight).toBe('bold');
		expect(body.lines[0].runs[0].font.weight).toBe('normal');
	});

	it('gives a bullet line a leading marker whose width counts toward the line width', () => {
		const withoutBullet = layoutRichText([line([run('item')])], OPTS, measure);
		const withBullet = layoutRichText([line([run('item')], { bullet: true })], OPTS, measure);

		expect(withBullet.lines[0].runs[0].text).toBe('• ');
		expect(withBullet.lines[0].runs[1].text).toBe('item');
		expect(withBullet.lines[0].widthPx).toBeGreaterThan(withoutBullet.lines[0].widthPx);
	});

	it('gives a blank line height but no runs, and does not widen the block', () => {
		const block = layoutRichText([line([run('word')]), line([])], OPTS, measure);

		expect(block.lines[1].runs).toEqual([]);
		expect(block.lines[1].heightPx).toBeGreaterThan(0);
		expect(block.lines[1].heightPx).toBeLessThan(block.lines[0].heightPx);
		expect(block.widthPx).toBe(block.lines[0].widthPx);
	});

	it('resolves inline code runs to the monospace family', () => {
		const block = layoutRichText([line([run('x', { code: true })])], OPTS, measure);
		expect(block.lines[0].runs[0].font.family).toBe(OPTS.monoFontFamily);
	});

	it('resolves italic runs to an italic font style', () => {
		const block = layoutRichText([line([run('x', { italic: true })])], OPTS, measure);
		expect(block.lines[0].runs[0].font.style).toBe('italic');
	});

	it('scales every output length proportionally with baseFontSizePx (the reference-width invariant)', () => {
		const lines = [line([run('word')]), line([], {}), line([run('another')], { heading: 2 })];
		const small = layoutRichText(lines, OPTS, measure);
		const large = layoutRichText(lines, { ...OPTS, baseFontSizePx: OPTS.baseFontSizePx * 2 }, measure);

		expect(large.widthPx).toBeCloseTo(small.widthPx * 2);
		expect(large.heightPx).toBeCloseTo(small.heightPx * 2);
		for (let i = 0; i < small.lines.length; i++) {
			expect(large.lines[i].heightPx).toBeCloseTo(small.lines[i].heightPx * 2);
			expect(large.lines[i].widthPx).toBeCloseTo(small.lines[i].widthPx * 2);
		}
	});

	it('uses the shared TEXT_BAND_LINE_HEIGHT multiplier for a body line', () => {
		const block = layoutRichText([line([run('x')])], OPTS, measure);
		expect(block.lines[0].heightPx).toBeCloseTo(OPTS.baseFontSizePx * TEXT_BAND_LINE_HEIGHT);
	});
});
