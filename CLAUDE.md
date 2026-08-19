## Commands

```bash
npm run dev                                       # dev server
npm run build                                     # production static build -> build/
npm run preview                                    # serve the production build locally
npm run check                                      # svelte-check + tsc (app + scripts/)
npm run test                                       # unit tests, single pass (vitest run)
npm run test:watch                                 # unit tests, watch mode
npx vitest run path/to/file.test.ts -t "name"       # one file / one test
npm run test:e2e                                    # e2e (builds + previews, then runs Chromium)
npx playwright test e2e/export.spec.ts -g "name"    # one e2e file / one test
npm run fetch-basemap                               # re-fetch static/basemap/*.json from Natural Earth
```

## Architecture

### The rendering core

Everything funnels through one function: `composeScene(renderer, input)` in `src/lib/render/scene.ts`. It's plain, ordered imperative code — draw background, land, admin1 borders (if enabled), admin0 borders, tracks, city dots + labels, overlay text — that calls methods on a `Renderer` (`src/lib/render/renderer.ts`). There are two implementations, `CanvasRenderer` and `SvgRenderer`, and **both call the exact same `composeScene`**. Neither has its own copy of the layout logic, which is what makes PNG/SVG output stay in sync automatically rather than something that has to be kept in sync by hand.

The live preview and the actual export are the same code path at different resolutions — both go through `buildSceneInput()` (`src/lib/render/buildSceneInput.ts`), which turns app state (tracks, settings, basemap) into a `SceneInput`. There's no separate "preview mode."

**Scale invariant:** every length in `SceneStyle` (stroke widths, font sizes, dot radius) is defined at a 1000px reference width and multiplied by `outputWidth / 1000` inside `composeScene`. This is what makes the preview a true proportional miniature of the export — doubling the output resolution doubles every stroke and font size exactly, not just the canvas dimensions. `render/scene.test.ts`'s "scale invariant" suite is the test that guards this; treat a failure there as a real regression, not a tolerance to loosen.

### Geo layer (`src/lib/geo/`)

`bbox.ts` and `projection.ts` handle antimeridian-crossing tracks (by convention, a `Bbox` tuple has `minLon > maxLon` when the region wraps through ±180°) and are deliberately **not** built on d3-geo's `fitExtent(extent, polygon)`. That was the first approach and it has two sharp edges, both reproduced empirically and documented in `projection.ts`'s header comment:

1. `fitExtent` measures a Polygon via `geoPath.bounds`, which depends on ring winding. A plain axis-aligned rectangle isn't guaranteed to win that ambiguity check, and on the losing side d3-geo silently falls back to the bounds of the *entire sphere* instead of erroring.
2. `geoPath` treats ring edges as great-circle arcs. A rectangle's top/bottom edges are lines of constant latitude, not great circles, so a wide/flat bbox's edges bulge poleward between corners and report a taller (more zoomed-out) extent than the bbox actually is.

`projection.ts` instead samples points directly along the bbox's parallels/meridians and computes scale/translate by hand — no Polygon ring involved, so neither failure mode applies. If you're tempted to "simplify" this back to `fitExtent`, don't — re-read that header comment first.

### GPX layer (`src/lib/gpx/`)

`parse.ts` wraps `@tmcw/togeojson`, which converts GPX's DOM into GeoJSON but stashes per-point timestamps *outside* the geometry (`properties.coordinateProperties.times`, shaped as `string[]` for a `LineString` or `string[][]` for a `MultiLineString`) since GeoJSON has no native per-point time. `types.ts`'s `Track.segments` re-attaches time and elevation to each point so the rest of the app never has to know about that togeojson-specific shape.

`stats.ts`'s elevation gain uses a hysteresis filter (5m threshold) rather than summing raw deltas — consumer GPS elevation noise is ±2-5m, and summing every uptick inflates gain 2-3x on a long track. See the test fixture there for the flat-but-noisy case this guards against.

### Label placement (`src/lib/render/labels.ts`)

Greedy placement (most important city first, by Natural Earth's `scalerank`; keep a candidate only if its box doesn't overlap an already-placed one). Text measurement is injected as a parameter rather than imported directly — jsdom (used in unit tests) has no Canvas 2D support, so the real measurer (`render/measure.ts`, backed by an offscreen canvas) is browser-only, while the placement algorithm itself stays unit-testable with a deterministic stand-in measurer.
