import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures/sample.gpx');

async function loadFixtureTrack(page: import('@playwright/test').Page) {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles(FIXTURE);
	await expect(page.locator('.track-list li')).toHaveCount(1);
}

async function setDimensions(page: import('@playwright/test').Page, width: number, height: number) {
	// Scoped to the export panel: the track list's width slider grew its own
	// number input (for precise value entry), which would otherwise shift
	// these indices.
	const numberInputs = page.locator('.export-panel input[type="number"]');
	await numberInputs.nth(0).fill(String(width));
	await numberInputs.nth(0).dispatchEvent('change');
	await numberInputs.nth(1).fill(String(height));
	await numberInputs.nth(1).dispatchEvent('change');
}

/** Reads a PNG's real pixel dimensions from its IHDR chunk (width/height are big-endian uint32 at offsets 16/20). */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * The basemap's 'basemap' phase always starts with an opaque background
 * rect spanning the entire canvas (land or water fill — see
 * composeScenePhase in scene.ts), so a pixel sampled anywhere on the map
 * layer is a reliable proxy for "the basemap bitmap was actually painted"
 * vs. left cleared/transparent by a caching bug. Sampled at the vertical
 * midpoint, to the left of any city label/credit/scale-bar text.
 */
async function cornerPixelIsOpaque(canvas: import('@playwright/test').Locator): Promise<boolean> {
	return canvas.evaluate((el: HTMLCanvasElement) => {
		const ctx = el.getContext('2d')!;
		const { data } = ctx.getImageData(2, Math.floor(el.height / 2), 1, 1);
		return data[3] === 255;
	});
}

test.describe('GPX export', () => {
	test('exports a PNG at the requested landscape resolution', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1600, 1200);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const download = await downloadPromise;
		const buffer = readFileSync(await download.path());

		expect(pngDimensions(buffer)).toEqual({ width: 1600, height: 1200 });
	});

	test('exports a PNG at a portrait resolution', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 900, 1600);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const download = await downloadPromise;
		const buffer = readFileSync(await download.path());

		expect(pngDimensions(buffer)).toEqual({ width: 900, height: 1600 });
	});

	test('exports a PNG at the maximum resolution', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 4000, 4000);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const download = await downloadPromise;
		const buffer = readFileSync(await download.path());

		expect(pngDimensions(buffer)).toEqual({ width: 4000, height: 4000 });
	});

	test('recovers from a zero width input instead of exporting blank', async ({ page }) => {
		await loadFixtureTrack(page);

		// Width only, entered directly rather than via setDimensions (which
		// always fills both fields) — this is the out-of-range case item 20
		// records: does the app corner-case a typed 0, or does it reach
		// buildProjection and render blank?
		const widthInput = page.locator('.export-panel input[type="number"]').nth(0);
		await widthInput.fill('0');
		await widthInput.dispatchEvent('change');

		const canvas = page.locator('.preview-container canvas.map-layer');
		await expect(page.getByText('Loading basemap…')).toHaveCount(0);
		expect(await cornerPixelIsOpaque(canvas)).toBe(true);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const download = await downloadPromise;
		const buffer = readFileSync(await download.path());

		const { width, height } = pngDimensions(buffer);
		expect(width).toBeGreaterThan(0);
		expect(height).toBeGreaterThan(0);
	});

	test('exports an SVG carrying the requested width and height', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1200, 800);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export SVG').click();
		const download = await downloadPromise;
		const svg = readFileSync(await download.path(), 'utf8');

		expect(svg).toContain('width="1200"');
		expect(svg).toContain('height="800"');
		expect(svg.startsWith('<svg')).toBe(true);
	});

	test('a multi-line markdown title never changes the exported PNG dimensions', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1000, 1000);

		const baselineDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const baselineDimensions = pngDimensions(readFileSync(await (await baselineDownload).path()));
		expect(baselineDimensions).toEqual({ width: 1000, height: 1000 });

		await page.getByLabel('Title', { exact: true }).fill('# Alpine Loop\n*July 2026*');

		// The title is drawn directly over the map, not by growing the
		// canvas, so the export must come back at exactly the size the user
		// asked for, regardless of how many lines the title now has.
		const titledDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const titledDimensions = pngDimensions(readFileSync(await (await titledDownload).path()));
		expect(titledDimensions).toEqual({ width: 1000, height: 1000 });
	});

	test('a markdown title reaches the exported SVG as separate styled runs', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1000, 1000);
		await page.getByLabel('Title', { exact: true }).fill('# Alpine Loop\n*July 2026*');

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export SVG').click();
		const svg = readFileSync(await (await downloadPromise).path(), 'utf8');

		expect(svg).toContain('>Alpine Loop<');
		expect(svg).toContain('>July 2026<');
		const julyText = svg.match(/<text[^>]*>July 2026<\/text>/);
		expect(julyText?.[0]).toContain('font-style="italic"');
	});

	test('enabling the minimap never changes the exported PNG dimensions', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1000, 1000);

		await page.getByLabel('Minimap', { exact: true }).check();

		// The minimap is an opaque panel drawn over the map, not something
		// that grows the canvas, so the export must still come back at
		// exactly the size the user asked for.
		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const dimensions = pngDimensions(readFileSync(await (await downloadPromise).path()));
		expect(dimensions).toEqual({ width: 1000, height: 1000 });
	});

	test('an SVG exported with the minimap on contains more paths than one without', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1000, 1000);

		const baselineDownload = page.waitForEvent('download');
		await page.getByText('Export SVG').click();
		const baselineSvg = readFileSync(await (await baselineDownload).path(), 'utf8');
		const baselinePaths = [...baselineSvg.matchAll(/<path/g)].length;

		await page.getByLabel('Minimap', { exact: true }).check();

		const minimapDownload = page.waitForEvent('download');
		await page.getByText('Export SVG').click();
		const minimapSvg = readFileSync(await (await minimapDownload).path(), 'utf8');
		const minimapPaths = [...minimapSvg.matchAll(/<path/g)].length;

		expect(minimapPaths).toBeGreaterThan(baselinePaths);
	});

	test('exporting twice in one session does not error', async ({ page }) => {
		await loadFixtureTrack(page);

		for (let i = 0; i < 2; i++) {
			const downloadPromise = page.waitForEvent('download');
			await page.getByText('Export PNG').click();
			const download = await downloadPromise;
			expect(readFileSync(await download.path()).length).toBeGreaterThan(0);
		}
	});
});

test.describe('basemap source', () => {
	test('switches to Natural Earth and back, exporting successfully from both', async ({ page }) => {
		await loadFixtureTrack(page);

		await page.locator('.segmented button', { hasText: 'Natural Earth' }).click();
		await expect(page.getByText('Export PNG')).toBeEnabled();
		const neDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		expect(readFileSync(await (await neDownload).path()).length).toBeGreaterThan(0);

		await page.locator('.segmented button', { hasText: 'OpenStreetMap' }).click();
		await expect(page.getByText('Export PNG')).toBeEnabled();
		const osmDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		expect(readFileSync(await (await osmDownload).path()).length).toBeGreaterThan(0);
	});

	test('disables export while the OSM basemap is unreachable', async ({ page, context }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		await context.route('**/tiles.openfreemap.org/**', (route) => route.abort());
		// Widen the framing far enough to land on a different tile cover, so
		// the preview issues a fresh (now-failing) request. A small nudge
		// wouldn't do it: tiles are cached per cover, and a framing change
		// that resolves to the cover already in hand never hits the network.
		// Selected by label rather than position: a page-wide number-input
		// index drifts whenever an earlier one is added (see setDimensions).
		const coverageInput = page.getByLabel('Minimum coverage (km)', { exact: true });
		await coverageInput.fill('800');
		await coverageInput.dispatchEvent('change');

		await expect(page.getByText('Export PNG')).toBeDisabled();
		await expect(page.getByText('Export SVG')).toBeDisabled();
	});
});

test.describe('preview redraws', () => {
	test('acknowledges a change immediately, before the redraw blocks the thread', async ({ page }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const preview = page.locator('.preview-container');
		await expect(preview).toHaveAttribute('aria-busy', 'false');

		// Composing the scene costs ~250ms, so both the control the user
		// touched and the busy badge have to be on screen before it starts —
		// not after it finishes. Playwright's auto-retrying assertions can
		// only catch that if a poll happens to land while it's still true;
		// a redraw fast enough to finish between polls would otherwise fail
		// this test for being too fast. Record the actual DOM mutations
		// instead, so the assertion holds regardless of how quickly the
		// redraw completes.
		await preview.evaluate((el) => {
			const w = window as unknown as { __busyHistory: Array<{ busy: string; hasBadge: boolean }> };
			const record = () => {
				w.__busyHistory.push({
					busy: el.getAttribute('aria-busy') ?? '',
					hasBadge: el.textContent?.includes('Updating preview') ?? false
				});
			};
			w.__busyHistory = [];
			record();
			new MutationObserver(record).observe(el, {
				attributes: true,
				attributeFilter: ['aria-busy'],
				childList: true,
				subtree: true,
				characterData: true
			});
		});

		const checkbox = page.locator('label.checkbox', { hasText: 'Show stats' }).locator('input');
		await checkbox.click();
		await expect(checkbox).not.toBeChecked();

		await expect(preview).toHaveAttribute('aria-busy', 'false');
		await expect(page.getByText('Updating preview…')).toHaveCount(0);

		const busyHistory = await preview.evaluate(
			(el) => (window as unknown as { __busyHistory: Array<{ busy: string; hasBadge: boolean }> }).__busyHistory
		);
		expect(busyHistory.some((entry) => entry.busy === 'true')).toBe(true);
		expect(busyHistory.some((entry) => entry.hasBadge)).toBe(true);
	});

	test('redraws without refetching tiles when an overlay-only setting changes', async ({ page }) => {
		let tileRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('tiles.openfreemap.org')) tileRequests++;
		});

		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();

		// Reset now that the initial load's own tile fetches are done, so
		// only requests caused by the actions below are counted.
		tileRequests = 0;

		// None of these change the framing, so the basemap must not be
		// refetched — but the preview still has to repaint.
		await page.getByText('Show stats').click();
		await page.getByText('Scale bar').click();
		await page.getByText('Show data credit').click();

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
		await expect(page.getByText('Loading basemap…')).toHaveCount(0);
		expect(tileRequests).toBe(0);
		// A screenshot changing isn't enough: a blank/transparent canvas also
		// differs from `before`. Confirm the basemap is actually still there.
		expect(await cornerPixelIsOpaque(canvas)).toBe(true);
	});

	test('dragging a track width slider redraws live without refetching tiles', async ({ page }) => {
		let tileRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('tiles.openfreemap.org')) tileRequests++;
		});

		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();

		// Reset now that the initial load's own tile fetches are done, so
		// only requests caused by the actions below are counted.
		tileRequests = 0;

		const widthSlider = page.locator('.width input[type="range"]');
		await widthSlider.fill('10');
		await widthSlider.dispatchEvent('input');

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
		expect(tileRequests).toBe(0);
	});

	test('enabling country names redraws the preview and still exports at the requested size', async ({ page }) => {
		let tileRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('tiles.openfreemap.org')) tileRequests++;
		});

		await loadFixtureTrack(page);
		await setDimensions(page, 1600, 1200);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();
		tileRequests = 0;

		await page.getByText('Country names').click();

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
		expect(tileRequests).toBe(0);
		expect(await cornerPixelIsOpaque(canvas)).toBe(true);

		const downloadPromise = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const download = await downloadPromise;
		const buffer = readFileSync(await download.path());
		expect(pngDimensions(buffer)).toEqual({ width: 1600, height: 1200 });
	});

	test('picking a track color swatch redraws live', async ({ page }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();

		await page.locator('.picker .swatch').click();
		const chips = page.locator('.picker .popover .chip');
		await expect(chips.first()).toBeVisible();
		// Pick a swatch that isn't already the track's default color.
		await chips.nth(1).click();

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
	});
});

test.describe('app UI', () => {
	test('loads the basemap and shows an empty-state hint with no tracks', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Load a GPX track to see the preview')).toBeVisible();
		await expect(page.getByText('No tracks loaded yet.')).toBeVisible();
	});

	test('surfaces a parse error for an invalid file without crashing', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('input[type="file"]')).toBeAttached();
		await page.evaluate(() => {
			// Simulate dropping a non-GPX file without needing a real bad fixture on disk.
			const dt = new DataTransfer();
			dt.items.add(new File(['not gpx'], 'bad.gpx', { type: 'application/gpx+xml' }));
			const input = document.querySelector('input[type="file"]') as HTMLInputElement;
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await expect(page.locator('.errors')).toBeVisible();
	});

	test('removing a track updates the preview back to the empty state', async ({ page }) => {
		await loadFixtureTrack(page);
		await page.getByRole('button', { name: 'Remove' }).click();
		await expect(page.getByText('Load a GPX track to see the preview')).toBeVisible();
	});
});
