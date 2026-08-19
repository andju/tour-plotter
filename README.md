# Track Mapper

Tour Plotter renders one or more GPX tracks over a minimal basemap (borders and
major cities only — no roads, terrain, or landuse) and exports the result as a
PNG or SVG at a user-chosen resolution. Framing is automatic: the app computes
a bounding box from the loaded tracks (expanded to a minimum coverage floor so
small tracks don't zoom to street level) and fits a projection to it. There is
no manual pan/zoom step.

## Tech Stack

SvelteKit (Svelte 5, runes mode) + TypeScript, `adapter-static`, client-only
(`ssr = false`, `prerender = true` in `src/routes/+layout.ts`). Vitest for unit
tests, Playwright/Chromium for e2e. Node 24 / npm 11.

Rendering is **d3-geo drawing to Canvas 2D or SVG**, not a tiled map library
(Leaflet/MapLibre). That choice follows directly from the app's two hard
requirements: export size is fixed by the user, not the viewport, and framing is
computed automatically from track bounds rather than composed by hand.
Tile-based maps snap to discrete zoom levels and cap out on WebGL canvas size;
`d3.geoMercator` + `geoPath` give exact, resolution-independent framing with no
size ceiling.

Basemap data comes from one of two sources, selectable in the Export panel:

- [Natural Earth](https://www.naturalearthdata.com/) (public domain, no
  attribution required), fetched and trimmed once via `npm run fetch-basemap`
  into `static/basemap/*.json` — land, country borders, state/province
  borders, and cities (filtered to `scalerank` in the shipped data; the "major
  cities" UI slider filters further at render time). No tile server, no API
  key, fully offline-capable.
- OpenStreetMap vector tiles, fetched live per-request from
  [OpenFreeMap](https://openfreemap.org/) (`OpenFreeMap · © OpenMapTiles ·
  Data from OpenStreetMap`), decoded and cached per bbox/zoom. This is the
  default and requires network access.