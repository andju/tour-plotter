import { describe, expect, it } from 'vitest';
import { parseRichText, type TextRun } from './markdown';

function plain(text: string): TextRun {
	return { text, bold: false, italic: false, strike: false, code: false };
}

describe('parseRichText', () => {
	it('returns no lines for empty input', () => {
		expect(parseRichText('')).toEqual([]);
	});

	it('parses a plain line as a single unstyled run', () => {
		expect(parseRichText('Alpine Traverse')).toEqual([{ runs: [plain('Alpine Traverse')], heading: 0, bullet: false }]);
	});

	it('parses **bold** and __bold__', () => {
		expect(parseRichText('**bold**')[0].runs).toEqual([{ ...plain('bold'), bold: true }]);
		expect(parseRichText('__bold__')[0].runs).toEqual([{ ...plain('bold'), bold: true }]);
	});

	it('parses *italic* and _italic_', () => {
		expect(parseRichText('*italic*')[0].runs).toEqual([{ ...plain('italic'), italic: true }]);
		expect(parseRichText('_italic_')[0].runs).toEqual([{ ...plain('italic'), italic: true }]);
	});

	it('parses ~~strikethrough~~', () => {
		expect(parseRichText('~~gone~~')[0].runs).toEqual([{ ...plain('gone'), strike: true }]);
	});

	it('parses `inline code`', () => {
		expect(parseRichText('`x = 1`')[0].runs).toEqual([{ ...plain('x = 1'), code: true }]);
	});

	it('nests bold and italic via ***text***', () => {
		expect(parseRichText('***wow***')[0].runs).toEqual([{ ...plain('wow'), bold: true, italic: true }]);
	});

	it('mixes styled and plain runs in one line', () => {
		expect(parseRichText('a **b** c')[0].runs).toEqual([plain('a '), { ...plain('b'), bold: true }, plain(' c')]);
	});

	it('leaves an unmatched delimiter as literal text', () => {
		expect(parseRichText('5 * 3 = 15')[0].runs).toEqual([plain('5 * 3 = 15')]);
	});

	it('does not treat underscores inside a word as delimiters', () => {
		expect(parseRichText('snake_case_name')[0].runs).toEqual([plain('snake_case_name')]);
	});

	it('honours backslash escapes for markdown-significant characters', () => {
		expect(parseRichText('\\*not italic\\*')[0].runs).toEqual([plain('*not italic*')]);
	});

	it('parses heading levels 1-6', () => {
		expect(parseRichText('# Title')[0]).toMatchObject({ heading: 1, bullet: false });
		expect(parseRichText('###### Small')[0]).toMatchObject({ heading: 6, bullet: false });
		expect(parseRichText('# Title')[0].runs).toEqual([plain('Title')]);
	});

	it('does not treat a bare "#" without a following space as a heading', () => {
		expect(parseRichText('#hashtag')[0]).toMatchObject({ heading: 0, bullet: false });
	});

	it('parses bullet list markers -, *, and +', () => {
		for (const marker of ['-', '*', '+']) {
			expect(parseRichText(`${marker} item`)[0]).toMatchObject({ bullet: true, heading: 0 });
			expect(parseRichText(`${marker} item`)[0].runs).toEqual([plain('item')]);
		}
	});

	it('does not read a leading "* " as a bullet when it is meant as italic on its own line', () => {
		// A single "*word*" with no trailing content after the closing delimiter
		// still starts with "*" + non-space, so it is not mistaken for a bullet.
		expect(parseRichText('*word*')[0]).toMatchObject({ bullet: false });
	});

	it('represents a blank line as a line with no runs', () => {
		expect(parseRichText('Title\n\nSubtitle')).toEqual([
			{ runs: [plain('Title')], heading: 0, bullet: false },
			{ runs: [], heading: 0, bullet: false },
			{ runs: [plain('Subtitle')], heading: 0, bullet: false }
		]);
	});

	it('splits on CRLF and lone CR the same as LF', () => {
		const expected = [
			{ runs: [plain('a')], heading: 0, bullet: false },
			{ runs: [plain('b')], heading: 0, bullet: false }
		];
		expect(parseRichText('a\r\nb')).toEqual(expected);
		expect(parseRichText('a\rb')).toEqual(expected);
		expect(parseRichText('a\nb')).toEqual(expected);
	});

	it('merges adjacent runs of the same style rather than splitting on every delimiter boundary', () => {
		// "**a**" immediately followed by "**b**" toggles bold off then on again;
		// the two resulting bold runs should merge into one.
		expect(parseRichText('**a****b**')[0].runs).toEqual([{ ...plain('ab'), bold: true }]);
	});
});
