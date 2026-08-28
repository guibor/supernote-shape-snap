# Snap Shapes design

`index.js` registers the lasso action. `src/shapeSnap.ts` reads the selection,
normalizes strokes, asks `src/shapeMatching.ts` for a classified shape, builds
geometry, and applies either a focused mutation or safe page replacement.
`snapCurrentSelection()` is the main transaction and permission boundary;
`buildFastPathPlan()` decides whether targeted mutation is safe;
`executeFastPath()` and `executeFallbackPageReplace()` apply the two strategies.
`src/exportDataset.ts` contains disabled developer-only sample export tools.
`permissions.ts` owns file access. Jest tests cover recognition and mutation planning.
