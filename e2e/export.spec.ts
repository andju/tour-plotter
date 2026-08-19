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
 * composeScenePhase in scene.ts), including any reserved title/description
 * band (the band is real map area now, not a separate blank strip — see
 * buildProjection's `topInsetPx`), so a pixel sampled anywhere on the map
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

	test('a title or description never changes the exported PNG dimensions', async ({ page }) => {
		await loadFixtureTrack(page);
		await setDimensions(page, 1000, 1000);

		const baselineDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const baselineDimensions = pngDimensions(readFileSync(await (await baselineDownload).path()));
		expect(baselineDimensions).toEqual({ width: 1000, height: 1000 });

		await page.getByLabel('Title').fill('Alpine Loop');
		await page.getByLabel('Description').fill('A weekend ride through the Alps.');

		// The title/description band is reserved *inside* the requested
		// dimensions (the map's own fit shrinks slightly to make room — see
		// buildProjection's `topInsetPx`), not by growing the canvas, so the
		// export must come back at exactly the size the user asked for.
		const titledDownload = page.waitForEvent('download');
		await page.getByText('Export PNG').click();
		const titledDimensions = pngDimensions(readFileSync(await (await titledDownload).path()));
		expect(titledDimensions).toEqual({ width: 1000, height: 1000 });
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
		const coverageInput = page.locator('input[type="number"]').nth(2);
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

		const checkbox = page.locator('label.checkbox', { hasText: 'Show stats' }).locator('input');
		await checkbox.click();

		// Composing the scene costs ~250ms, so both the control the user
		// touched and the busy badge have to be on screen before it starts —
		// not after it finishes.
		await expect(checkbox).not.toBeChecked();
		await expect(preview).toHaveAttribute('aria-busy', 'true');
		await expect(page.getByText('Updating preview…')).toBeVisible();

		await expect(preview).toHaveAttribute('aria-busy', 'false');
		await expect(page.getByText('Updating preview…')).toHaveCount(0);
	});

	test('redraws without refetching tiles when an overlay-only setting changes', async ({ page }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		let tileRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('tiles.openfreemap.org')) tileRequests++;
		});

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();

		// None of these change the framing, so the basemap must not be
		// refetched — but the preview still has to repaint.
		await page.getByText('Show stats').click();
		await page.getByText('Scale bar').click();
		await page.getByText('Show data credit').click();
		await page.getByLabel('Description').fill('A description');

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
		await expect(page.getByText('Loading basemap…')).toHaveCount(0);
		expect(tileRequests).toBe(0);
		// A screenshot changing isn't enough: a blank/transparent canvas also
		// differs from `before`. Confirm the basemap is actually still there.
		expect(await cornerPixelIsOpaque(canvas)).toBe(true);
	});

	test('the basemap is visible beside the title pill, not a blank strip', async ({ page }) => {
		// Regression test for the "map pushed down, no basemap left/right of
		// the title" bug: title/description used to reserve space by growing
		// the canvas and shifting the map down, leaving a brand-new strip at
		// the top with no basemap data fetched for it (a flat fill in the
		// preview). Now the band is reserved inside the map's own fit (see
		// buildProjection's `topInsetPx`), so real basemap paints all the way
		// to the top of the canvas, including beside the pill.
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		await page.getByLabel('Title').fill('Alpine Loop');

		// Sampled near the very top-left corner — inside the reserved band,
		// away from the centred title pill — where the old behaviour left an
		// untouched (transparent, then flat-filled) strip.
		await expect
			.poll(() =>
				canvas.evaluate((el: HTMLCanvasElement) => {
					const ctx = el.getContext('2d')!;
					const { data } = ctx.getImageData(2, 2, 1, 1);
					return data[3] === 255;
				})
			)
			.toBe(true);
	});

	test('overlay-only settings redraw the basemap, not just clear it, once a title is set', async ({ page }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		const canvas = page.locator('.preview-container canvas.map-layer');
		const titleInput = page.getByLabel('Title');
		await titleInput.fill('Alpine Loop');
		await expect.poll(() => cornerPixelIsOpaque(canvas)).toBe(true);

		for (const action of [
			() => page.getByText('Show stats').click(),
			() => page.getByText('Scale bar').click(),
			() => page.getByText('Show data credit').click(),
			async () => {
				const citySizeSlider = page.locator('.city-size input[type="range"]');
				await citySizeSlider.fill('2');
				await citySizeSlider.dispatchEvent('input');
			}
		]) {
			await action();
			// Polls rather than reading once: the redraw is deferred two
			// animation frames, so this also gives the (buggy) cleared-but-
			// never-repainted bitmap a fair chance to resolve before failing.
			await expect.poll(() => cornerPixelIsOpaque(canvas)).toBe(true);
		}
	});

	test('dragging a track width slider redraws live without refetching tiles', async ({ page }) => {
		await loadFixtureTrack(page);
		await expect(page.getByText('Export PNG')).toBeEnabled();

		let tileRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('tiles.openfreemap.org')) tileRequests++;
		});

		const canvas = page.locator('.preview-container canvas.map-layer');
		const before = await canvas.screenshot();

		const widthSlider = page.locator('.width input[type="range"]');
		await widthSlider.fill('10');
		await widthSlider.dispatchEvent('input');

		await expect
			.poll(async () => Buffer.compare(await canvas.screenshot(), before))
			.not.toBe(0);
		expect(tileRequests).toBe(0);
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
