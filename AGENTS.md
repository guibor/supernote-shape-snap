# Snap Shapes — Agent Notes

This file is the main hook for agent-oriented repo context. Keep the public README user-facing and keep iteration details, active benchmarks, and working notes here.

## Repo Intent

- Supernote plugin for snapping rough lasso-selected ink into clean shapes
- Optimize for real notebook use on e-ink:
  - low latency
  - local redraw instead of full-page blanking when possible
  - conservative no-match behavior on text, scribbles, and unsupported shapes

## Important Constraints

- Keep the internal plugin key stable:
  - `pluginKey = supernote_shape_snap`
  - `AppRegistry.registerComponent(...)` must continue to use the same app name
- The displayed plugin name can change independently:
  - `PluginConfig.json.name`
  - `app.json.displayName`
- The package artifact name still comes from `package.json.name`, so the built file remains:
  - `build/outputs/supernote_shape_snap.snplg`

## Important Files

- [index.js](index.js): button registration
- [src/shapeMatching.ts](src/shapeMatching.ts): shape matcher
- [src/shapeSnap.ts](src/shapeSnap.ts): lasso handling and write-back
- [src/exportDataset.ts](src/exportDataset.ts): sample/note export actions
- [docs/shape-snap-requirements.md](docs/shape-snap-requirements.md): product bar
- [docs/shape-snap-algorithm.md](docs/shape-snap-algorithm.md): algorithm notes
- [docs/shape-snap-status.md](docs/shape-snap-status.md): rolling status

## Button/UI State

Current buttons:

- Lasso action: `Snap Shapes`
- Lasso action: `Export Sample`
- Toolbar action: `Export Note`

Current limitation:

- There is still no actual settings/sidebar customization UI.
- Earlier discussion about configurable knobs was not implemented.
- If a user says the sidebar has no options, that is expected with the current code.

## Benchmark Fixtures

Primary regression fixtures:

- [__tests__/fixtures/sample-page-2026-04-09.json](__tests__/fixtures/sample-page-2026-04-09.json)
- [__tests__/fixtures/sample-page-2026-04-09-191519.json](__tests__/fixtures/sample-page-2026-04-09-191519.json)

First fixture expectations:

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

Second fixture locked expectations:

- element 2 -> triangle
- elements 3, 4, 5 -> rectangle
- element 9 -> pentagon

When changing matcher behavior, protect both fixtures.

## Current Algorithm Direction

- Resampled, corner-first digital-ink pipeline
- Stroke stitching and closing-tail trimming
- Family-specific fitting for lines, curves, and polygons
- Orientation cleanup for near-horizontal / near-vertical output
- Triangle recovery exists, but must not steal strong rectangle intent

Recent important lesson:

- Reduced-triangle recovery can become too aggressive.
- Strong multi-source quadrilateral evidence must win for rectangle-like loops.

## Open Items

- Add a real toolbar/sidebar settings surface with a small set of high-signal knobs
- Keep improving triangle reliability on broader real samples
- Tighten no-match behavior for unsupported irregular 5-sided “house” shapes
- Investigate duplicated page payloads in note export for `20260409_191519`

## Tests

Run before shipping matcher or write-path changes:

```sh
npm run typecheck
npx jest __tests__/shapeMatching.test.ts __tests__/shapeSnap.test.ts --runInBand --watchman=false
```

## Build

```sh
bash ./buildPlugin.sh
```

Artifact:

```text
build/outputs/supernote_shape_snap.snplg
```

Public tracked artifact:

```text
dist/supernote_shape_snap.snplg
```

After rebuilding for a public package, copy the build output into `dist/` and update the README checksum.

## Supernote Transfer Notes

- Verified HTTP endpoint on this machine has been `http://10.100.102.19:8089`
- The device HTTP upload path has recently returned `507 Not enough memory` even when the device reported ample free space
- Treat that as a device/service-state issue, not necessarily a real storage-capacity issue

## Editing Guidance

- Keep README user-facing
- Record durable algorithm/product changes in `docs/`
- Use new real exported samples to create regression fixtures before changing thresholds
