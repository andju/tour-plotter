# Geo layer (`src/lib/geo/`)

`bbox.ts` and `projection.ts` handle antimeridian-crossing tracks (by convention, a `Bbox` tuple has `minLon > maxLon` when the region wraps through ±180°) and are deliberately **not** built on d3-geo's `fitExtent(extent, polygon)`. That was the first approach and it has two sharp edges, both reproduced empirically and documented in `projection.ts`'s header comment:

1. `fitExtent` measures a Polygon via `geoPath.bounds`, which depends on ring winding. A plain axis-aligned rectangle isn't guaranteed to win that ambiguity check, and on the losing side d3-geo silently falls back to the bounds of the *entire sphere* instead of erroring.
2. `geoPath` treats ring edges as great-circle arcs. A rectangle's top/bottom edges are lines of constant latitude, not great circles, so a wide/flat bbox's edges bulge poleward between corners and report a taller (more zoomed-out) extent than the bbox actually is.

`projection.ts` instead samples points directly along the bbox's parallels/meridians and computes scale/translate by hand — no Polygon ring involved, so neither failure mode applies. If you're tempted to "simplify" this back to `fitExtent`, don't — re-read that header comment first.
