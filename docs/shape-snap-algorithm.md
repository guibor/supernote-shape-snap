# Shape Snap Algorithm

## Purpose

This document describes the intended matching and replacement algorithm in product-neutral terms. It is not tied to React Native, TypeScript, or any particular SDK.

The design goal is to recognize hand-drawn geometric intent while keeping false positives low and keeping the write path local and fast.

## High-Level Strategy

Use a two-stage approach:

1. Decide whether the selected strokes look intentionally geometric at all.
2. If they do, fit a small set of candidate shape families and choose the best one using normalized error plus weak family-specific priors.

The write-back path should be local to the selected content whenever possible.

The current implementation is intentionally biased toward deterministic, local geometry decisions:

- resample paths spatially so drawing speed does not affect the geometry
- stitch nearby stroke endpoints before fitting
- trim small closing overshoots before interpreting a shape as closed
- route obvious lines, curves, and polygons through small family-specific fitters
- fall back quickly on no-match instead of escalating to slow page-level work

## Input Model

The algorithm operates on the lasso-selected strokes only.

For each selected stroke cluster, derive:

- ordered stroke path samples
- contour samples if available
- bounding box
- centroid
- approximate orientation
- path length
- closure gap
- convex hull

The ordered contour of the drawn stroke should be treated as the primary signal for polygons. The convex hull is a fallback, not the first source of truth.

## Step 1: Split the Selection into Shape Candidates

Group selected strokes into independent clusters using:

- layer compatibility
- bounding-box overlap or near-overlap
- endpoint proximity
- spatial distance relative to the cluster scale

Each cluster is evaluated independently.

This avoids forcing a single lasso containing several shapes into one combined interpretation.

## Step 2: Fast Rejection of Non-Shapes

Before fitting shapes, reject clusters that are likely handwriting or doodles.

Useful rejection signals:

- extremely small selection
- highly open path with no strong line evidence
- too many turning events after simplification
- low convexity for an intended closed shape
- text or handwriting hints from upstream recognition metadata if available

The rejection rule should be conservative:

- false positive snapping is worse than a conservative no-op
- but rough polygons should not be rejected merely because their corners are noisy

## Step 3: Decide Open vs Closed Intent

Estimate whether the cluster was intended as:

- an open mark, usually a line
- a closed shape

Use a combination of:

- endpoint distance normalized by shape size
- filledness of the contour or hull relative to the bounding box
- number and distribution of strong corners

A slightly open loop may still be a closed-shape intent.

## Step 4: Build a Stable Contour Representation

Construct an ordered contour suitable for corner analysis.

Recommended approach:

- start from the dominant closed stroke path when available
- if multiple strokes form the shape, merge them into an ordered contour if possible
- otherwise use the convex hull as fallback

Then simplify the contour in two passes:

1. geometric simplification to remove dense sampling noise
2. corner consolidation to merge nearby or nearly collinear vertices

This stage is crucial. Polygon recognition quality depends more on corner extraction quality than on downstream scoring.

In practice, this stage also does the most to stabilize Supernote ink:

- resampling removes pen-speed density artifacts
- tail trimming prevents small overlaps from inflating corner counts
- open-shape simplification gives retraced triangles and rectangles a second chance before rejection

## Step 5: Extract Corner Hypotheses

For polygon-like shapes, detect corner candidates from turning behavior rather than from raw hull vertex count alone.

Recommended signals:

- turning angle magnitude
- persistence of turning over a small arc neighborhood
- local support length on both adjacent edges
- separation between adjacent corner candidates

Then:

- suppress weak corners
- merge nearby corner peaks
- enforce a minimum edge length

This produces a stable estimated corner sequence.

## Step 6: Generate Candidate Shapes

Generate candidates from a small fixed family set.

### Line

Fit a principal axis and measure orthogonal deviation.

Accept only if:

- span is large relative to shape size
- orthogonal error is low
- anisotropy is strongly one-dimensional

### Circle

Fit center and radius from radial statistics.

Score by:

- radial error
- isotropy

### Ellipse

Fit major and minor axes from the principal frame.

Score by:

- boundary distance to the ellipse

### Rectangle and Square

Use an orthogonal frame, then fit a 4-corner shape.

Important detail:

- the fit should be corner-aware, not only PCA-aware
- rectangle quality should depend on edge support and corner consistency
- square quality should add only a weak equal-side penalty

### Triangle and 5-8 Sided Polygons

Use the extracted ordered corner sequence.

Accept a polygon candidate when:

- the corner count is stable
- edges have enough support
- edge lengths and turn angles are reasonably consistent with an intended polygon

For 4-sided shapes, do not use arbitrary quadrilateral output in v1. Route them through rectangle/square logic.

Triangle handling needs one extra recovery rule in practice:

- if a drawn triangle picks up one or two weak extra corners from wobble or rounding, derive a reduced 3-corner candidate from the extracted contour and let that compete as triangle intent
- if multiple triangle routes agree, triangle should beat a nearby rectangle or higher-sided polygon fallback
- but do not let reduced-triangle recovery override a stable quadrilateral when multiple independent simplification paths already agree on rectangle or square intent

## Step 7: Score Candidates

Each candidate gets a normalized score where lower is better.

The score should combine:

- average boundary distance from the drawn contour to the fitted shape
- edge or corner support quality
- area or coverage consistency
- family-specific penalties only where justified

The score should be scale-normalized so the same thresholds behave similarly on small and large shapes.

## Step 8: Apply Decision Rules

Choose the best candidate, then apply weak priors only within sibling families:

- circle can beat ellipse if their scores are nearly tied
- square can beat rectangle if their scores are nearly tied

Do not apply a strong simplicity prior across unrelated families.

Examples:

- a genuine triangle should not become a circle because the circle score is slightly lower
- a clear pentagon should not be forced into a rectangle family

Finally, require the winning score to clear a confidence threshold. If it does not, return no match.

The current tuning priority inside this step is:

- keep ellipse-vs-polygon arbitration conservative
- allow circle-over-ellipse preference only for genuinely near-isotropic loops
- allow open-triangle recovery when the contour is obviously triangular but not cleanly closed

## Step 8.5: Normalize Near-Axis Orientation

After a candidate family has already been chosen, optionally regularize its orientation.

Rules:

- inspect the final line direction, polygon edge directions, or ellipse axes
- if any of those directions is within 10 degrees of horizontal, rotate the entire geometry to exact horizontal alignment
- otherwise, if any is within 10 degrees of vertical, rotate the entire geometry to exact vertical alignment
- prefer horizontal over vertical when both are available

This is a post-fit cleanup step. It should not change the chosen family or try to rescue a bad fit. Its only purpose is to remove small residual tilt from shapes that were already drawn as nearly horizontal or vertical.

## Step 9: Write Back Efficiently

The write path should be chosen separately from the matcher.

Preferred path for ordinary stroke-only lasso selections:

- delete the selected lasso strokes
- insert the snapped geometry directly
- clear the lasso state

Fallback path only when necessary:

- partial replacement inside a mixed selection
- cases where preserving unmatched selected content requires a page-level rewrite

The algorithm should avoid full-page clear-and-rewrite for common lasso snapping because that harms perceived performance and causes visible page blanking.

## Failure Behavior

Two kinds of failure should be treated differently.

### Normal no-match

This is not an error. It means the cluster did not confidently look like a supported shape.

Desired behavior:

- return quickly
- leave the page unchanged
- avoid heavy IO or visible redraw

### Execution failure

This includes storage, insertion, deletion, or API errors.

Desired behavior:

- preserve document integrity
- report a real error
- avoid partial destructive changes where possible

## Tuning Priorities

If tradeoffs are required, optimize in this order:

1. avoid false positives on text and scribbles
2. make ordinary circle, square, rectangle, and triangle cases reliable
3. keep common snaps visually local and fast
4. improve rarer polygon families
5. expand the supported shape vocabulary

## Practical Consequence

The current weak area in many systems like this is not ellipse fitting. It is polygon corner extraction and polygon confidence handling.

If triangles and squares are failing while circles work, the likely root cause is one or both of:

- unstable contour simplification and corner counting
- overly strict polygon acceptance thresholds

That should be treated as the main algorithmic improvement area.

## Current Benchmark Use

The repo now carries a reduced fixture from a real exported Supernote sample page:

- [sample-page-2026-04-09.json](/Users/mdf/code/supernote-shape-snap/__tests__/fixtures/sample-page-2026-04-09.json)

It is used as a regression target because it exercises the current failure-prone zones in one page:

- rounded rectangles
- circle vs ellipse discrimination
- open or retraced triangles
- pentagon side-count stability
- rejection of false polygon hypotheses on elongated ovals
