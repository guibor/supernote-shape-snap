# Snap Shapes

Snap Shapes is a Supernote plugin that turns rough hand-drawn lasso selections into clean geometry, including multiple independent shapes inside one lasso.

Current supported output families:

- line
- circle
- ellipse
- triangle
- rectangle
- square
- pentagon
- hexagon
- heptagon
- octagon

The plugin is designed for real notebook use, not idealized geometry. The main goals are:

- keep the write path local to the lassoed content
- avoid full-page blanking during ordinary snaps
- strongly avoid false positives on text and scribbles
- regularize geometry in useful ways, including near-axis alignment

## Current Behavior

The matcher currently uses a resampled, corner-first digital-ink pipeline with:

- spatial resampling
- stroke stitching
- closing-tail trimming
- conservative text and scribble rejection
- curve fitting for circles and ellipses
- polygon fitting for triangles through octagons
- explicit polygon closure on Supernote write-back
- post-fit orientation snapping when a line, polygon edge, or ellipse axis is already within 10 degrees of horizontal or vertical

Write-path behavior:

- ordinary lasso-only snaps use a fast local replace path
- recognized notes degrade gracefully when layer APIs are unavailable
- polygon geometry is emitted as a closed ring so the final edge is reliably drawn on device

## Repo Guide

- [docs/shape-snap-requirements.md](docs/shape-snap-requirements.md) — product requirements and acceptance criteria
- [docs/shape-snap-algorithm.md](docs/shape-snap-algorithm.md) — implementation-neutral algorithm notes
- [docs/shape-snap-status.md](docs/shape-snap-status.md) — current benchmark and known ambiguities

Important source files:

- [index.js](index.js) — plugin registration and button wiring
- [src/shapeMatching.ts](src/shapeMatching.ts) — matcher and geometry normalization
- [src/shapeSnap.ts](src/shapeSnap.ts) — lasso selection handling and Supernote write path
- [src/exportDataset.ts](src/exportDataset.ts) — benchmark export actions

## Benchmarking

The current active regression fixtures are:

- [__tests__/fixtures/sample-page-2026-04-09.json](__tests__/fixtures/sample-page-2026-04-09.json)
- [__tests__/fixtures/sample-page-2026-04-09-191519.json](__tests__/fixtures/sample-page-2026-04-09-191519.json)

The first fixture is a reduced real-device export from a Supernote page containing 10 isolated hand-drawn shapes. The second fixture is a later note export page that specifically caught the rectangle-to-triangle regression.

The current expected labels for the first page are:

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

The current regression expectations from the second page are:

- element 2 -> triangle
- elements 3, 4, 5 -> rectangle
- element 9 -> pentagon

Tests:

- [__tests__/shapeMatching.test.ts](__tests__/shapeMatching.test.ts)
- [__tests__/shapeSnap.test.ts](__tests__/shapeSnap.test.ts)

## Dataset Export Workflow

The plugin also includes export actions to support offline matcher tuning.

- `Export Sample`
  - exports the current lasso selection as JSON plus a page preview PNG
  - intended for benchmark collection
- `Export Note`
  - exports a raw `.note` plus page-level JSON for every page
  - intended for archival and later re-segmentation

Export output on device:

- `MyStyle/supernote_shape_snap_exports/samples/`
- `MyStyle/supernote_shape_snap_exports/notes/`

## Build

From the repo root:

```sh
npm install
npm run typecheck
npx jest __tests__/shapeMatching.test.ts __tests__/shapeSnap.test.ts --runInBand --watchman=false
bash ./buildPlugin.sh
```

The packaged plugin is written to:

```text
build/outputs/supernote_shape_snap.snplg
```

## Install on Supernote

Upload the `.snplg` to:

```text
MyStyle/
```

Then install on the device:

```text
Settings -> Apps -> Plugins -> Add Plugin
```

## Open Items

- The left-side settings/customization UI discussed earlier is not implemented yet. The current plugin still exposes only lasso actions plus the export toolbar action.
- Triangle recovery is now guarded against stealing strong rectangles, but broader triangle reliability still needs more real samples beyond the current benchmark pages.
- Unsupported “house” or other irregular 5-sided shapes still need a stricter no-match path so they do not drift into regular pentagons.
- The note export path produced duplicated page payloads for `20260409_191519`; that exporter bug still needs investigation.
