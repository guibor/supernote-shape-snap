# Shape Snap Status

## Current State

The plugin is now on the fast lasso-local write path for ordinary single-shape replacements, which removed the earlier full-page blanking behavior.

The active algorithm is a resampled, corner-first matcher with:

- spatial resampling
- stroke stitching
- closing-tail trimming
- fast non-shape rejection
- curve fitting for circle and ellipse
- polygon fitting with special handling for rectangles and open triangles
- post-fit orientation snapping for near-horizontal and near-vertical geometry

## Active Benchmark

The current working benchmark is a reduced fixture from a real exported Supernote sample page:

- [sample-page-2026-04-09.json](/Users/mdf/code/supernote-shape-snap/__tests__/fixtures/sample-page-2026-04-09.json)

That page contains 10 isolated hand-drawn shapes and is the current regression target for local iteration.

Expected labels:

1. rectangle
2. rectangle
3. circle
4. ellipse
5. ellipse
6. triangle
7. ellipse
8. pentagon
9. ellipse
10. rectangle

## Why This Benchmark Matters

This one page concentrates the failure modes that mattered most in real use:

- rough but intended rectangles
- near-circle vs ellipse ambiguity
- retraced or open triangles
- polygon side-count drift
- elongated ovals that should not get misread as polygons

## Current Design Direction

The matcher is being tuned with these priorities:

1. Keep no-match fast and local.
2. Avoid false polygon snaps on smooth curves.
3. Recover ordinary notebook triangles and rectangles even when they are not perfectly closed.
4. Apply weak family priors only within sibling families, especially circle vs ellipse and square vs rectangle.

The write path is also being tightened around two Supernote-specific constraints:

- recognized notes may reject layer APIs, so layer preservation must be best-effort rather than mandatory
- `GEO_polygon` geometry should be emitted as an explicitly closed point ring so the final edge is drawn reliably on device

The orientation policy is now explicit too:

- if a final line, polygon edge, or ellipse axis is within 10 degrees of horizontal, snap it to horizontal
- otherwise, if one is within 10 degrees of vertical, snap it to vertical
- horizontal wins when both are plausible

## Known Ambiguities

- The benchmark page is strong enough for iteration but not broad enough for final confidence.
- Shape 7 on the sample page is still the softest semantic case. It currently remains in the ellipse family, which is acceptable for now because it is clearly not a polygon and still reads as intentional geometry.
- Broader validation still needs more exported samples, especially negatives and multi-stroke shapes.

## Next Expansion

After the sample page is stable, the next benchmark set should add:

- more negative examples labeled `none`
- multi-stroke shapes
- larger and smaller versions of the same shape
- intentionally rough squares, rectangles, and triangles
- more 5-8 sided polygons
