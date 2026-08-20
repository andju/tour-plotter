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
			`d="${d}"`,
			`fill="${style.fill ?? 'none'}"`,
			style.stroke ? `stroke="${style.stroke}"` : '',
			style.stroke ? `stroke-width="${style.strokeWidthPx ?? 1}"` : '',
			style.stroke ? `stroke-linejoin="round" stroke-linecap="round"` : '',
			style.stroke && style.dashPx?.length ? `stroke-dasharray="${style.dashPx.join(',')}"` : '',
			style.opacity !== undefined ? `opacity="${style.opacity}"` : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<path ${attrs} />`);
	}

	circle(xy: [number, number], radiusPx: number, style: FillStyle): void {
		const attrs = [
			`cx="${xy[0]}"`,
			`cy="${xy[1]}"`,
			`r="${radiusPx}"`,
			`fill="${style.fill}"`,
			style.stroke ? `stroke="${style.stroke}"` : '',
			style.stroke ? `stroke-width="${style.strokeWidthPx ?? 1}"` : '',
			style.opacity !== undefined ? `opacity="${style.opacity}"` : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<circle ${attrs} />`);
	}

	polygon(points: [number, number][], style: FillStyle): void {
		const attrs = [
			`points="${points.map(([x, y]) => `${x},${y}`).join(' ')}"`,
			`fill="${style.fill}"`,
			style.stroke ? `stroke="${style.stroke}"` : '',
			style.stroke ? `stroke-width="${style.strokeWidthPx ?? 1}"` : '',
			style.opacity !== undefined ? `opacity="${style.opacity}"` : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<polygon ${attrs} />`);
	}

	text(xy: [number, number], value: string, style: TextStyle): void {
		const hasHalo = Boolean(style.haloColor && style.haloWidthPx);
		const attrs = [
			`x="${xy[0]}"`,
			`y="${xy[1]}"`,
			`font-family="${style.font.family}"`,
			`font-size="${style.font.sizePx}"`,
			style.font.weight ? `font-weight="${style.font.weight}"` : '',
			style.font.style && style.font.style !== 'normal' ? `font-style="${style.font.style}"` : '',
			`fill="${style.fill}"`,
			`text-anchor="${svgAnchor(style.anchor)}"`,
			`dominant-baseline="middle"`,
			hasHalo ? `stroke="${style.haloColor}"` : '',
			hasHalo ? `stroke-width="${(style.haloWidthPx as number) * 2}"` : '',
			hasHalo ? `stroke-linejoin="round"` : '',
			hasHalo ? `paint-order="stroke"` : ''
		]
			.filter(Boolean)
			.join(' ');
		this.elements.push(`<text ${attrs}>${escapeXml(value)}</text>`);
	}

	rect(x: number, y: number, w: number, h: number, style: RectStyle): void {
		const attrs = [
			`x="${x}"`,
			`y="${y}"`,
			`width="${w}"`,
			`height="${h}"`,
			`fill="${style.fill ?? 'none'}"`,
			style.stroke ? `stroke="${style.stroke}"` : '',
			style.stroke ? `stroke-width="${style.strokeWidthPx ?? 1}"` : '',
			style.opacity !== undefined ? `opacity="${style.opacity}"` : ''
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

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
