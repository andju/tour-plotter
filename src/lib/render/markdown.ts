/**
 * Deliberately text-only subset of markdown for the title field: emphasis,
 * strikethrough, inline code, headings, bullet lists. No images/links/
 * tables/code fences/block quotes — nothing this app could ever draw with
 * Renderer's `text`/`rect` primitives. A hand-rolled parser rather than a
 * dependency (marked/markdown-it) since their HTML-oriented token sets still
 * need a custom mapping to draw runs, and carry dead weight (images, tables,
 * links) this never uses.
 */

export interface TextRun {
	text: string;
	bold: boolean;
	italic: boolean;
	strike: boolean;
	code: boolean;
}

export interface RichLine {
	/** Empty for a blank line — callers render it as vertical spacing only. */
	runs: TextRun[];
	/** 0 for a body line, 1-6 for `#`-`######`. */
	heading: number;
	bullet: boolean;
}

const ESCAPABLE = new Set(['*', '_', '~', '`', '#', '\\']);

/** Delimiters tried longest-first, so `***bold italic***` opens bold before italic. */
const DELIMITERS: { marker: string; flag: keyof Omit<TextRun, 'text'> }[] = [
	{ marker: '**', flag: 'bold' },
	{ marker: '__', flag: 'bold' },
	{ marker: '~~', flag: 'strike' },
	{ marker: '`', flag: 'code' },
	{ marker: '*', flag: 'italic' },
	{ marker: '_', flag: 'italic' }
];

export function parseRichText(source: string): RichLine[] {
	if (source === '') return [];
	return source.split(/\r\n|\r|\n/).map((line) => parseLine(line));
}

function parseLine(line: string): RichLine {
	const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
	if (headingMatch) {
		return { runs: parseInline(headingMatch[2]), heading: headingMatch[1].length, bullet: false };
	}

	const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
	if (bulletMatch) {
		return { runs: parseInline(bulletMatch[1]), heading: 0, bullet: true };
	}

	return { runs: parseInline(line), heading: 0, bullet: false };
}

function parseInline(text: string): TextRun[] {
	const runs: TextRun[] = [];
	const flags = { bold: false, italic: false, strike: false, code: false };
	let buffer = '';

	const flush = () => {
		if (buffer) runs.push({ text: buffer, ...flags });
		buffer = '';
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i];

		if (ch === '\\' && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
			buffer += text[i + 1];
			i += 2;
			continue;
		}

		// Inside a code run, only a closing backtick is special.
		if (flags.code) {
			if (ch === '`') {
				flush();
				flags.code = false;
				i += 1;
				continue;
			}
			buffer += ch;
			i += 1;
			continue;
		}

		const delimiter = matchDelimiter(text, i, flags);
		if (delimiter) {
			flush();
			flags[delimiter.flag] = !flags[delimiter.flag];
			i += delimiter.marker.length;
			continue;
		}

		buffer += ch;
		i += 1;
	}

	flush();
	return mergeAdjacent(runs);
}

/**
 * Finds a delimiter starting at `i`, requiring a matching closer later in the
 * line before treating it as an opener — otherwise a lone `*` (e.g. `5 * 3`)
 * would toggle italic and never close, swallowing the rest of the line.
 * `_`/`__` additionally require a word boundary on the opening side, so
 * `snake_case_names` passes through untouched.
 */
function matchDelimiter(
	text: string,
	i: number,
	flags: Record<keyof Omit<TextRun, 'text'>, boolean>
): { marker: string; flag: keyof Omit<TextRun, 'text'> } | null {
	for (const { marker, flag } of DELIMITERS) {
		if (!text.startsWith(marker, i)) continue;

		// Closing an already-open run of this flag: always accepted, no
		// lookahead needed — the opener already validated the pair.
		if (flags[flag]) return { marker, flag };

		if (marker[0] === '_') {
			const before = text[i - 1];
			if (before && /\w/.test(before)) continue;
		}

		const closeAt = text.indexOf(marker, i + marker.length);
		if (closeAt === -1) continue;

		if (marker[0] === '_') {
			const after = text[closeAt + marker.length];
			if (after && /\w/.test(after)) continue;
		}

		return { marker, flag };
	}
	return null;
}

function mergeAdjacent(runs: TextRun[]): TextRun[] {
	const merged: TextRun[] = [];
	for (const run of runs) {
		const last = merged[merged.length - 1];
		if (last && last.bold === run.bold && last.italic === run.italic && last.strike === run.strike && last.code === run.code) {
			last.text += run.text;
		} else {
			merged.push({ ...run });
		}
	}
	return merged;
}
