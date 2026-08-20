# GPX layer (`src/lib/gpx/`)

`parse.ts` wraps `@tmcw/togeojson`, which converts GPX's DOM into GeoJSON but stashes per-point timestamps *outside* the geometry (`properties.coordinateProperties.times`, shaped as `string[]` for a `LineString` or `string[][]` for a `MultiLineString`) since GeoJSON has no native per-point time. `types.ts`'s `Track.segments` re-attaches time and elevation to each point so the rest of the app never has to know about that togeojson-specific shape.

`stats.ts`'s elevation gain uses a hysteresis filter (5m threshold) rather than summing raw deltas — consumer GPS elevation noise is ±2-5m, and summing every uptick inflates gain 2-3x on a long track. See the test fixture there for the flat-but-noisy case this guards against.
