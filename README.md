# Snap Shapes

Snap Shapes is a Supernote plugin that turns rough lasso-selected ink into clean geometry. It is designed for fast notebook use, conservative no-match behavior on non-shapes, and local write-back that avoids full-page flashing in ordinary cases.

## Example

<p align="center">
  <img src="assets/screenshots/before-snap.png" alt="Rough hand-drawn circle and rectangle before snapping" width="48%" />
  <img src="assets/screenshots/after-snap.png" alt="Snapped clean circle and rectangle after running Snap Shapes" width="48%" />
</p>

<p align="center">
  <em>Left: rough input. Right: snapped result.</em>
</p>

## Supported Shapes

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

## Current Behavior

- Works on lasso selections in `NOTE` and `DOC`
- Can snap multiple independent shapes inside one lasso
- Prefers local lasso replacement over full-page rewrite
- Ignores many text-like and scribbly selections instead of forcing a snap
- Regularizes near-horizontal and near-vertical geometry

## Download

The latest compiled Supernote plugin package is tracked in the repo:

- [dist/supernote_shape_snap.snplg](dist/supernote_shape_snap.snplg)

Current packaged version:

- `versionName`: `0.0.5`
- `versionCode`: `5`
- SHA-256: `1181ee7b1c9671fbe998276ec97d1b2a9d3a83697fc2bd57b046c25ecfa7dbe1`

## Repo Layout

- [docs/shape-snap-requirements.md](docs/shape-snap-requirements.md): product requirements
- [docs/shape-snap-algorithm.md](docs/shape-snap-algorithm.md): algorithm notes
- [docs/shape-snap-status.md](docs/shape-snap-status.md): current status and known issues
- [AGENTS.md](AGENTS.md): agent-oriented working notes, benchmarks, and iteration workflow

Key implementation files:

- [index.js](index.js)
- [src/shapeMatching.ts](src/shapeMatching.ts)
- [src/shapeSnap.ts](src/shapeSnap.ts)
- [src/exportDataset.ts](src/exportDataset.ts)

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

1. Copy [dist/supernote_shape_snap.snplg](dist/supernote_shape_snap.snplg) to `MyStyle/`
2. On device, open `Settings -> Apps -> Plugins -> Add Plugin`
3. Install the package

## Release Notes

- The current known-good release line is `0.0.5`.
- When testing a fix on-device, always ship a higher `versionCode` than the currently installed package. Otherwise the device may keep the older broken install and make a working revert look broken.

## Notes

- The displayed plugin name is `Snap Shapes`
- The internal plugin key remains `supernote_shape_snap` for compatibility
- The package filename remains `supernote_shape_snap.snplg`
