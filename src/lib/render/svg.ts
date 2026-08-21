import { geoPath, type GeoProjection } from 'd3-geo';
import type { FillStyle, PathStyle, RectStyle, Renderer, TextStyle } from './renderer';

export class SvgRenderer implements Renderer {
	private readonly toPathData: (geometry: GeoJSON.Geometry) => string | null;
	private readonly elements: string[];

	constructor(
		private readonly width: number,
		private readonly height: number,
		projection: GeoProjection,
		elements: string[] = []
	) {
		this.toPathData = geoPath(projection);
		// Shared by reference with any withProjection() child, so a sub-renderer's
		// output lands in the same document in draw order rather than a separate
		// buffer that would need merging.
		this.elements = elements;
	}

	path(geometry: GeoJSON.Geometry, style: PathStyle): void {
		const d = this.toPathData(geometry);
		if (!d) return;
		const attrs = [
			attr('d', d),
			attr('fill', style.fill ?? 'none'),
			style.stroke ? attr('stroke', style.stroke) : '',
			style.stroke ? attr('stroke-width', style.strokeWidthPx ?? 1) : '',
			style.stroke ? `stroke-linejoin="round" stroke-linecap="round"` : '',
			style.stroke && style.dashPx?.length ? attr('stroke-dasharray', style.dashPx.join(',')) : '',
			style.opacity !== undefined ? attr('opacity', style.opacity) : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<path ${attrs} />`);
	}

	circle(xy: [number, number], radiusPx: number, style: FillStyle): void {
		const attrs = [
			attr('cx', xy[0]),
			attr('cy', xy[1]),
			attr('r', radiusPx),
			attr('fill', style.fill),
			style.stroke ? attr('stroke', style.stroke) : '',
			style.stroke ? attr('stroke-width', style.strokeWidthPx ?? 1) : '',
			style.opacity !== undefined ? attr('opacity', style.opacity) : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<circle ${attrs} />`);
	}

	polygon(points: [number, number][], style: FillStyle): void {
		const attrs = [
			attr('points', points.map(([x, y]) => `${x},${y}`).join(' ')),
			attr('fill', style.fill),
			style.stroke ? attr('stroke', style.stroke) : '',
			style.stroke ? attr('stroke-width', style.strokeWidthPx ?? 1) : '',
			style.opacity !== undefined ? attr('opacity', style.opacity) : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<polygon ${attrs} />`);
	}

	text(xy: [number, number], value: string, style: TextStyle): void {
		const hasHalo = Boolean(style.haloColor && style.haloWidthPx);
		// SVG has no reliable cross-renderer equivalent of Canvas's
		// textBaseline = 'middle': dominant-baseline="middle" is ignored by
		// Inkscape, older librsvg, and several print pipelines, which fall
		// back to the alphabetic baseline and sit visibly lower. Shifting y
		// by a fixed fraction of the font size reproduces the same visual
		// centering without depending on the attribute. 0.35 approximates a
		// typical face's (ascent - descent) / 2 as a fraction of em size.
		const baselineShift = 0.35 * style.font.sizePx;
		const y = xy[1] + baselineShift;
		const shared = [
			attr('x', xy[0]),
			attr('y', y),
			attr('font-family', style.font.family),
			attr('font-size', style.font.sizePx),
			style.font.weight ? attr('font-weight', style.font.weight) : '',
			style.font.style && style.font.style !== 'normal' ? attr('font-style', style.font.style) : '',
			attr('text-anchor', svgAnchor(style.anchor))
		];
		const escaped = escapeXml(value);
		if (hasHalo) {
			// Two elements, stroke then fill, mirroring CanvasRenderer's
			// strokeText-then-fillText draw order — the halo sits behind the
			// glyph by construction rather than by paint-order support.
			const strokeAttrs = [
				...shared,
				`fill="none"`,
				attr('stroke', style.haloColor as string),
				attr('stroke-width', (style.haloWidthPx as number) * 2),
				`stroke-linejoin="round"`
			]
				.filter(Boolean)
				.join(' ');
			this.elements.push(`<text ${strokeAttrs}>${escaped}</text>`);
		}
		const fillAttrs = [...shared, attr('fill', style.fill)].filter(Boolean).join(' ');
		this.elements.push(`<text ${fillAttrs}>${escaped}</text>`);
	}

	rect(x: number, y: number, w: number, h: number, style: RectStyle): void {
		const attrs = [
			attr('x', x),
			attr('y', y),
			attr('width', w),
			attr('height', h),
			attr('fill', style.fill ?? 'none'),
			style.stroke ? attr('stroke', style.stroke) : '',
			style.stroke ? attr('stroke-width', style.strokeWidthPx ?? 1) : '',
			style.opacity !== undefined ? attr('opacity', style.opacity) : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<rect ${attrs} />`);
	}

	withProjection(projection: GeoProjection): Renderer {
		return new SvgRenderer(this.width, this.height, projection, this.elements);
	}

	serialize(): string {
		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">`,
			...this.elements,
			`</svg>`
		].join('\n');
	}
}

function svgAnchor(anchor: TextStyle['anchor']): string {
	if (anchor === 'middle') return 'middle';
	if (anchor === 'end') return 'end';
	return 'start';
}

function attr(name: string, value: string | number): string {
	return `${name}="${escapeXml(String(value))}"`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
