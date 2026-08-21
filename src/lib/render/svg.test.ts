import { describe, expect, it } from 'vitest';
import { buildProjection } from '../geo/projection';
import type { Bbox } from '../geo/bbox';
import { SvgRenderer } from './svg';

const bbox: Bbox = [13.0, 52.0, 13.5, 52.5];

function makeRenderer() {
	const projection = buildProjection(1000, 1000, bbox, 20);
	return new SvgRenderer(1000, 1000, projection);
}

describe('SvgRenderer — attribute escaping', () => {
	it('escapes a fill value containing " and < in circle()', () => {
		const renderer = makeRenderer();
		renderer.circle([10, 10], 5, { fill: '"><script>alert(1)</script>' });
		const svg = renderer.serialize();
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('fill="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
	});

	it('escapes a fill value containing " and < in rect()', () => {
		const renderer = makeRenderer();
		renderer.rect(0, 0, 10, 10, { fill: '" onmouseover="alert(1)' });
		const svg = renderer.serialize();
		expect(svg).toContain('fill="&quot; onmouseover=&quot;alert(1)"');
	});

	it('escapes a fill value containing " and < in text()', () => {
		const renderer = makeRenderer();
		renderer.text([0, 0], 'hello', {
			font: { family: '"><b>', sizePx: 12 },
			fill: '"><b>',
			anchor: 'start'
		});
		const svg = renderer.serialize();
		expect(svg).not.toContain('<b>');
		expect(svg).toContain('font-family="&quot;&gt;&lt;b&gt;"');
		expect(svg).toContain('fill="&quot;&gt;&lt;b&gt;"');
	});
});
