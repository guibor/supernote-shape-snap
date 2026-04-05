# Shape Snap Requirements

## Goal

Convert a lasso-selected hand-drawn shape into a clean geometric shape on Supernote, while leaving non-shapes untouched.

This feature is successful only if it feels immediate and predictable during normal note-taking. Accuracy matters, but latency and false positives matter almost as much.

## Primary Use Case

A user draws a rough shape by hand, lasso-selects it, taps `Snap Shape`, and expects:

- the original strokes inside the lasso to be replaced
- a clean shape to appear in nearly the same place and size
- the rest of the page to remain visually stable

## Supported Shape Families

The matcher should support these output families:

- circle
- ellipse
- rectangle
- square
- triangle
- pentagon
- hexagon
- heptagon
- octagon
- straight line

The set may grow later, but these are the required v1 targets.

## Core Product Requirements

### 1. Only modify what is under the lasso

- Replace only the selected strokes that belong to matched shapes.
- Do not rewrite or visibly refresh the whole page for ordinary shape snapping.
- Do not alter unrelated page content.

### 2. Prefer correct shape family over over-snapping

- A rough circle should become a circle.
- A clear oval should remain an ellipse.
- A rough rectangle should become a rectangle.
- A near-square should become a square.
- A rough triangle should become a triangle even if imperfect.
- A rough pentagon through octagon should map to the corresponding polygon if the side count is clear enough.

### 3. Use weak simplicity priors, not strong ones

- Prefer circle over ellipse only when both fit nearly equally well.
- Prefer square over rectangle only when both fit nearly equally well.
- Do not force a simpler family when the evidence clearly supports another family.

### 4. Reject text, letters, and scribbles

- Handwriting, letters, short text, symbols, and general doodles should be ignored.
- The default behavior for ambiguous input is no-op, not aggressive snapping.
- The matcher should be conservative about false positives.

### 5. Failure should be fast and quiet

- If no good shape match exists, do nothing quickly.
- A no-match result should not trigger slow page-level IO.
- A no-match result should not visually blank the page.
- Error dialogs should be reserved for true execution failures, not normal no-match outcomes.

## UX Requirements

### Latency

- A simple single-shape lasso should usually complete fast enough to feel local to the lasso action.
- Target: no full-page blanking.
- Target: visible response for common single-shape cases should feel near-instant or only slightly delayed.
- If an operation takes long enough to be noticed, it may show lightweight progress feedback, but only if that feedback is less distracting than the delay itself.

### Visual Stability

- The page should not flash blank during ordinary snapping.
- The resulting shape should appear in place of the original strokes, not layered on top of them.
- Shape style should stay visually close to the user's drawing:
  - similar pen color
  - similar stroke width
  - similar layer when possible

### Predictability

- Similar drawings should produce similar results.
- Small drawing noise should not change the detected family dramatically.
- If the algorithm is uncertain, it should refuse to snap rather than guess wildly.

## Functional Requirements

### Selection Handling

- The input is the already-created lasso selection.
- The system may contain one shape or several separate shapes inside a single lasso.
- Multiple selected shapes should be processed independently when they are separable.

### Shape Placement

- The snapped geometry should preserve approximate:
  - center
  - rotation
  - scale
  - layer

### Multi-Shape Behavior

- If a lasso contains several valid shapes, each valid shape should be snapped independently.
- If a lasso contains a shape plus non-shape strokes, valid shapes may be snapped and non-shapes should remain untouched.

## Quality Bar

The matcher should be tuned for notebook reality, not idealized geometry.

That means:

- tolerate moderate wobble in corners and edges
- tolerate slightly open loops for intended closed shapes
- tolerate rounded corners on intended polygons
- avoid requiring mathematically clean vertices to recognize a shape

The current quality bottleneck is polygon robustness, especially for triangles and squares. That is a first-order accuracy problem, not an edge case.

## Non-Goals

- Perfect geometric recognition for arbitrary sketches
- Arbitrary quadrilateral classification beyond rectangle/square
- Recognition of stars, arrows, clouds, or flowchart symbols in v1
- Decomposing one continuous complex doodle into multiple primitives
- OCR or semantic interpretation of handwriting

## Acceptance Criteria

The feature should be considered acceptable when all of the following are usually true in normal use:

- rough circles reliably snap to circles
- clear ovals stay ellipses
- rough squares and rectangles usually snap correctly
- rough triangles usually snap correctly
- 5-8 sided polygons work when the side count is visually clear
- handwriting and text are usually ignored
- no-match cases return quickly
- common successful snaps do not blank the full page

