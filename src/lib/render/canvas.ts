import { geoPath, type GeoProjection } from 'd3-geo';
import type { FillStyle, PathStyle, Renderer, TextStyle } from './renderer';

export class CanvasRenderer implements Renderer {
	private readonly project: (geometry: GeoJSON.Geometry) => void;

	constructor(
		private readonly ctx: CanvasRenderingContext2D,
		projection: GeoProjection
	) {
		const path = geoPath(projection, ctx);
		this.project = (geometry) => path(geometry);
	}

	path(geometry: GeoJSON.Geometry, style: PathStyle): void {
		this.ctx.save();
		this.ctx.globalAlpha = style.opacity ?? 1;
		this.ctx.beginPath();
		this.project(geometry);
		if (style.fill) {
			this.ctx.fillStyle = style.fill;
			this.ctx.fill();
		}
		if (style.stroke) {
			this.ctx.strokeStyle = style.stroke;
			this.ctx.lineWidth = style.strokeWidthPx ?? 1;
			this.ctx.lineJoin = 'round';
			this.ctx.lineCap = 'round';
			this.ctx.setLineDash(style.dashPx ?? []);
			this.ctx.stroke();
		}
		this.ctx.restore();
	}

	circle(xy: [number, number], radiusPx: number, style: FillStyle): void {
		this.ctx.save();
		this.ctx.globalAlpha = style.opacity ?? 1;
		this.ctx.beginPath();
		this.ctx.arc(xy[0], xy[1], radiusPx, 0, 2 * Math.PI);
		this.ctx.fillStyle = style.fill;
		this.ctx.fill();
		this.ctx.restore();
	}

	text(xy: [number, number], value: string, style: TextStyle): void {
		this.ctx.save();
		this.ctx.font = `${style.font.weight ?? 'normal'} ${style.font.sizePx}px ${style.font.family}`;
		this.ctx.textAlign = canvasAlign(style.anchor);
		this.ctx.textBaseline = 'middle';
		if (style.haloColor && style.haloWidthPx) {
			this.ctx.strokeStyle = style.haloColor;
			this.ctx.lineWidth = style.haloWidthPx * 2;
			this.ctx.lineJoin = 'round';
			this.ctx.strokeText(value, xy[0], xy[1]);
		}
		this.ctx.fillStyle = style.fill;
		this.ctx.fillText(value, xy[0], xy[1]);
		this.ctx.restore();
	}

	rect(x: number, y: number, w: number, h: number, style: FillStyle): void {
		this.ctx.save();
		this.ctx.globalAlpha = style.opacity ?? 1;
		this.ctx.fillStyle = style.fill;
		this.ctx.fillRect(x, y, w, h);
		this.ctx.restore();
	}
}

// TextStyle uses SVG's anchor vocabulary ('middle') since both renderers
// share the same style types; Canvas just spells the center case differently.
function canvasAlign(anchor: TextStyle['anchor']): CanvasTextAlign {
	if (anchor === 'middle') return 'center';
	if (anchor === 'end') return 'end';
	return 'start';
}
