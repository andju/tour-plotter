# Track Mapper

Tour Plotter renders one or more GPX tracks over a minimal basemap (borders and
major cities only — no roads, terrain, or landuse) and exports the result as a
PNG or SVG at a user-chosen resolution. Framing is automatic: the app computes
a bounding box from the loaded tracks (expanded to a minimum coverage floor so
small tracks don't zoom to street level) and fits a projection to it. There is
no manual pan/zoom step.
