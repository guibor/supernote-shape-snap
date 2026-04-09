export type PointLike = {
  x: number;
  y: number;
};

export type ShapeKind =
  | 'line'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'rectangle'
  | 'square'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon';

export type GeometryDescriptor =
  | {
      type: 'line';
      points: [PointLike, PointLike];
    }
  | {
      type: 'ellipse';
      center: PointLike;
      majorRadius: number;
      minorRadius: number;
      angle: number;
    }
  | {
      type: 'polygon';
      points: PointLike[];
    };

export type ShapeMatch = {
  kind: ShapeKind;
  score: number;
  geometry: GeometryDescriptor;
  diagnostics: {
    closureGap: number;
    fillRatio: number;
    simplifiedVertexCount: number;
  };
};

export type ShapeDetectionInput = {
  samplePoints: PointLike[];
  strokePaths: PointLike[][];
  recognitionNames?: string[];
};

export type ShapeDebugInfo = {
  reason: string | null;
  closureGap: number;
  fillRatio: number;
  inkDensity: number;
  canBeClosed: boolean;
  lineCandidate: ShapeKind | null;
  curveCandidate: ShapeKind | null;
  extractedCornerCount: number;
  extractedMeanSaliency: number;
  extractedMeanTurn: number;
  simplifiedClosedCandidate: ShapeKind | null;
  simplifiedClosedVertexCount: number;
  simplifiedOpenCandidate: ShapeKind | null;
  simplifiedOpenVertexCount: number;
  openHullCandidate: ShapeKind | null;
  openHullVertexCount: number;
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  diagonal: number;
  area: number;
  center: PointLike;
};

type Candidate = {
  kind: ShapeKind;
  score: number;
  geometry: GeometryDescriptor;
};

type CircularCorner = {
  index: number;
  saliency: number;
  ratio: number;
  turn: number;
};

const MIN_COMPONENT_POINTS = 6;
const MIN_COMPONENT_SIZE = 18;
const MAX_STROKES = 5;
const MAX_INK_DENSITY = 4.8;
const MAX_OPEN_SELF_INTERSECTIONS = 4;
const MAX_CLOSED_SELF_INTERSECTIONS = 2;
const CLOSED_GAP_THRESHOLD = 0.24;
const MIN_FILL_RATIO = 0.08;
const MIN_CLOSED_DENSITY = 1.7;
const LINE_MAX_SCORE = 0.045;
const CURVE_MAX_SCORE = 0.11;
const TRIANGLE_MAX_SCORE = 0.14;
const RECTANGLE_MAX_SCORE = 0.18;
const POLYGON_MAX_SCORE = 0.14;
const CIRCLE_PREFERENCE_MARGIN = 0.026;
const SQUARE_PREFERENCE_MARGIN = 0.018;
const CIRCLE_AXIS_RATIO_THRESHOLD = 1.15;
const CURVE_OVER_POLYGON_MARGIN = 0.018;
const POLYGON_OVER_CURVE_MARGIN = 0.012;
const STRONG_CORNER_SALIENCY = 0.24;
const STRONG_CORNER_TURN = 0.46;
const OPEN_POLYGON_MAX_GAP = 0.9;
const ORIENTATION_SNAP_THRESHOLD = (10 * Math.PI) / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function square(value: number): number {
  return value * value;
}

function distance(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dot(a: PointLike, b: PointLike): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: PointLike, b: PointLike): number {
  return a.x * b.y - a.y * b.x;
}

function subtract(a: PointLike, b: PointLike): PointLike {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function add(a: PointLike, b: PointLike): PointLike {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function scale(point: PointLike, factor: number): PointLike {
  return {
    x: point.x * factor,
    y: point.y * factor,
  };
}

function normalize(point: PointLike): PointLike {
  const magnitude = Math.hypot(point.x, point.y);
  if (magnitude < 0.000001) {
    return {x: 1, y: 0};
  }

  return {
    x: point.x / magnitude,
    y: point.y / magnitude,
  };
}

function midpoint(left: PointLike, right: PointLike): PointLike {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function uniquePoints(points: PointLike[]): PointLike[] {
  const seen = new Set<string>();
  const result: PointLike[] = [];

  for (const point of points) {
    const key = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(point);
  }

  return result;
}

function dedupeSequential(points: PointLike[]): PointLike[] {
  if (points.length <= 1) {
    return points.slice();
  }

  const result = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = result[result.length - 1];
    if (!previous || distance(previous, point) > 0.5) {
      result.push(point);
    }
  }

  return result;
}

function flattenPoints(paths: PointLike[][]): PointLike[] {
  return paths.flatMap(path => path);
}

function centroid(points: PointLike[]): PointLike {
  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    {x: 0, y: 0},
  );

  return {
    x: total.x / Math.max(points.length, 1),
    y: total.y / Math.max(points.length, 1),
  };
}

function buildBounds(points: PointLike[]): Bounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  const width = Math.max(right - left, 1);
  const height = Math.max(bottom - top, 1);

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    diagonal: Math.hypot(width, height),
    area: width * height,
    center: {
      x: left + width / 2,
      y: top + height / 2,
    },
  };
}

function polygonArea(points: PointLike[]): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
}

function signedPolygonArea(points: PointLike[]): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function pathLength(points: PointLike[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function pointLineSide(
  origin: PointLike,
  target: PointLike,
  point: PointLike,
): number {
  return (
    (target.x - origin.x) * (point.y - origin.y) -
    (target.y - origin.y) * (point.x - origin.x)
  );
}

function convexHull(points: PointLike[]): PointLike[] {
  const sorted = uniquePoints(points).sort((left, right) => {
    if (left.x === right.x) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });

  if (sorted.length <= 3) {
    return sorted;
  }

  const lower: PointLike[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      pointLineSide(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: PointLike[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      pointLineSide(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function distanceToSegment(
  point: PointLike,
  start: PointLike,
  end: PointLike,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < 0.000001) {
    return distance(point, start);
  }

  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );

  return distance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function averageDistanceToSegments(
  points: PointLike[],
  segments: Array<[PointLike, PointLike]>,
): number {
  if (!points.length || !segments.length) {
    return Number.POSITIVE_INFINITY;
  }

  let total = 0;
  for (const point of points) {
    let best = Number.POSITIVE_INFINITY;
    for (const [start, end] of segments) {
      best = Math.min(best, distanceToSegment(point, start, end));
    }
    total += best;
  }

  return total / points.length;
}

function buildPolygonSegments(points: PointLike[]): Array<[PointLike, PointLike]> {
  if (points.length < 2) {
    return [];
  }

  const segments: Array<[PointLike, PointLike]> = [];
  for (let index = 0; index < points.length; index += 1) {
    segments.push([points[index], points[(index + 1) % points.length]]);
  }

  return segments;
}

function principalAxes(points: PointLike[]): {
  center: PointLike;
  majorAxis: PointLike;
  minorAxis: PointLike;
  majorVariance: number;
  minorVariance: number;
} {
  const center = centroid(points);

  let xx = 0;
  let xy = 0;
  let yy = 0;

  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  xx /= Math.max(points.length, 1);
  xy /= Math.max(points.length, 1);
  yy /= Math.max(points.length, 1);

  const trace = xx + yy;
  const delta = Math.sqrt(Math.max(square(xx - yy) + 4 * square(xy), 0));
  const majorVariance = (trace + delta) / 2;
  const minorVariance = (trace - delta) / 2;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);

  return {
    center,
    majorAxis: {x: Math.cos(angle), y: Math.sin(angle)},
    minorAxis: {x: -Math.sin(angle), y: Math.cos(angle)},
    majorVariance,
    minorVariance,
  };
}

function project(point: PointLike, axis: PointLike, origin: PointLike): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

function interpolateAlongSegments(
  segments: Array<{start: PointLike; end: PointLike; length: number; offset: number}>,
  position: number,
): PointLike {
  const target = Math.max(position, 0);

  for (const segment of segments) {
    if (target <= segment.offset + segment.length) {
      const ratio =
        segment.length < 0.000001
          ? 0
          : (target - segment.offset) / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
  }

  const last = segments[segments.length - 1];
  return last ? {...last.end} : {x: 0, y: 0};
}

function resamplePolyline(
  points: PointLike[],
  spacing: number,
  closed: boolean,
): PointLike[] {
  let vertices = dedupeSequential(points);
  if (vertices.length < 2) {
    return vertices.slice();
  }

  if (
    closed &&
    distance(vertices[0], vertices[vertices.length - 1]) < Math.max(spacing * 0.75, 1)
  ) {
    vertices = vertices.slice(0, -1);
  }

  const segments: Array<{
    start: PointLike;
    end: PointLike;
    length: number;
    offset: number;
  }> = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  let totalLength = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const segmentLength = distance(start, end);
    if (segmentLength < 0.000001) {
      continue;
    }

    segments.push({
      start,
      end,
      length: segmentLength,
      offset: totalLength,
    });
    totalLength += segmentLength;
  }

  if (!segments.length || totalLength < 0.000001) {
    return vertices.slice();
  }

  const sampleCount = closed
    ? Math.max(Math.round(totalLength / spacing), Math.min(vertices.length, 16))
    : Math.max(Math.round(totalLength / spacing), 2);
  const result: PointLike[] = [];
  const iterations = closed ? sampleCount : sampleCount + 1;

  for (let index = 0; index < iterations; index += 1) {
    const position = (totalLength * index) / sampleCount;
    result.push(interpolateAlongSegments(segments, position));
  }

  return dedupeSequential(result);
}

function longestPath(paths: PointLike[][]): PointLike[] {
  if (!paths.length) {
    return [];
  }

  return paths.reduce((best, path) =>
    pathLength(path) > pathLength(best) ? path : best,
  );
}

function containsTextSignal(recognitionNames: string[]): boolean {
  return recognitionNames.some(name =>
    /(text|letter|word|char|digit|number|handwriting|symbol)/i.test(name),
  );
}

function endpointDistanceInfo(
  path: PointLike[],
  merged: PointLike[],
): {
  distance: number;
  attachToStart: boolean;
  reversePath: boolean;
} {
  const mergedStart = merged[0];
  const mergedEnd = merged[merged.length - 1];
  const pathStart = path[0];
  const pathEnd = path[path.length - 1];

  const options = [
    {
      distance: distance(mergedEnd, pathStart),
      attachToStart: false,
      reversePath: false,
    },
    {
      distance: distance(mergedEnd, pathEnd),
      attachToStart: false,
      reversePath: true,
    },
    {
      distance: distance(pathEnd, mergedStart),
      attachToStart: true,
      reversePath: false,
    },
    {
      distance: distance(pathStart, mergedStart),
      attachToStart: true,
      reversePath: true,
    },
  ];

  return options.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
}

function stitchStrokePaths(paths: PointLike[][], joinThreshold: number): PointLike[] {
  const remaining = paths
    .map(path => dedupeSequential(path))
    .filter(path => path.length >= 2);

  if (!remaining.length) {
    return [];
  }

  let seedIndex = 0;
  for (let index = 1; index < remaining.length; index += 1) {
    if (pathLength(remaining[index]) > pathLength(remaining[seedIndex])) {
      seedIndex = index;
    }
  }

  let merged = remaining.splice(seedIndex, 1)[0].slice();

  while (remaining.length) {
    let bestIndex = 0;
    let bestInfo = endpointDistanceInfo(remaining[0], merged);

    for (let index = 1; index < remaining.length; index += 1) {
      const info = endpointDistanceInfo(remaining[index], merged);
      if (info.distance < bestInfo.distance) {
        bestInfo = info;
        bestIndex = index;
      }
    }

    let nextPath = remaining.splice(bestIndex, 1)[0].slice();
    if (bestInfo.reversePath) {
      nextPath = nextPath.slice().reverse();
    }

    if (bestInfo.attachToStart) {
      const shouldDrop =
        distance(nextPath[nextPath.length - 1], merged[0]) < joinThreshold * 0.45;
      if (shouldDrop) {
        nextPath = nextPath.slice(0, -1);
      }
      merged = nextPath.concat(merged);
      continue;
    }

    const shouldDrop =
      distance(merged[merged.length - 1], nextPath[0]) < joinThreshold * 0.45;
    if (shouldDrop) {
      nextPath = nextPath.slice(1);
    }
    merged = merged.concat(nextPath);
  }

  return dedupeSequential(merged);
}

function segmentIntersection(
  firstStart: PointLike,
  firstEnd: PointLike,
  secondStart: PointLike,
  secondEnd: PointLike,
): PointLike | null {
  const firstVector = subtract(firstEnd, firstStart);
  const secondVector = subtract(secondEnd, secondStart);
  const denominator = cross(firstVector, secondVector);

  if (Math.abs(denominator) < 0.000001) {
    return null;
  }

  const offset = subtract(secondStart, firstStart);
  const firstRatio = cross(offset, secondVector) / denominator;
  const secondRatio = cross(offset, firstVector) / denominator;

  if (
    firstRatio < -0.000001 ||
    firstRatio > 1.000001 ||
    secondRatio < -0.000001 ||
    secondRatio > 1.000001
  ) {
    return null;
  }

  return {
    x: firstStart.x + firstVector.x * firstRatio,
    y: firstStart.y + firstVector.y * firstRatio,
  };
}

function trimClosingTails(points: PointLike[], threshold: number): PointLike[] {
  const path = dedupeSequential(points);
  if (path.length < 8) {
    return path;
  }

  const headLimit = Math.min(Math.floor(path.length * 0.28), 18);
  const tailStart = Math.max(Math.floor(path.length * 0.72), path.length - 18);

  let bestIntersection:
    | {
        startIndex: number;
        endIndex: number;
        point: PointLike;
      }
    | null = null;

  for (let startIndex = 0; startIndex < headLimit - 1; startIndex += 1) {
    for (let endIndex = tailStart; endIndex < path.length - 1; endIndex += 1) {
      if (endIndex <= startIndex + 2) {
        continue;
      }

      const intersection = segmentIntersection(
        path[startIndex],
        path[startIndex + 1],
        path[endIndex],
        path[endIndex + 1],
      );

      if (!intersection) {
        continue;
      }

      if (
        !bestIntersection ||
        endIndex - startIndex >
          bestIntersection.endIndex - bestIntersection.startIndex
      ) {
        bestIntersection = {
          startIndex,
          endIndex,
          point: intersection,
        };
      }
    }
  }

  if (bestIntersection) {
    return [
      bestIntersection.point,
      ...path.slice(bestIntersection.startIndex + 1, bestIntersection.endIndex + 1),
      bestIntersection.point,
    ];
  }

  let bestNearPair:
    | {
        startIndex: number;
        endIndex: number;
      }
    | null = null;

  for (let startIndex = 0; startIndex < headLimit; startIndex += 1) {
    for (let endIndex = tailStart; endIndex < path.length; endIndex += 1) {
      if (endIndex <= startIndex + 3) {
        continue;
      }

      if (distance(path[startIndex], path[endIndex]) > threshold) {
        continue;
      }

      if (
        !bestNearPair ||
        endIndex - startIndex > bestNearPair.endIndex - bestNearPair.startIndex
      ) {
        bestNearPair = {
          startIndex,
          endIndex,
        };
      }
    }
  }

  if (!bestNearPair) {
    return path;
  }

  const joint = midpoint(path[bestNearPair.startIndex], path[bestNearPair.endIndex]);
  return [
    joint,
    ...path.slice(bestNearPair.startIndex + 1, bestNearPair.endIndex),
    joint,
  ];
}

function simplifyRdp(points: PointLike[], epsilon: number): PointLike[] {
  if (points.length <= 2) {
    return points.slice();
  }

  const start = points[0];
  const end = points[points.length - 1];
  let maxDistance = 0;
  let splitIndex = -1;

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentDistance = distanceToSegment(points[index], start, end);
    if (currentDistance > maxDistance) {
      maxDistance = currentDistance;
      splitIndex = index;
    }
  }

  if (maxDistance <= epsilon || splitIndex < 0) {
    return [start, end];
  }

  const left = simplifyRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function collapseClosedVertices(
  vertices: PointLike[],
  minimumEdge: number,
): PointLike[] {
  let result = uniquePoints(vertices);
  if (result.length < 3) {
    return result;
  }

  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;

    for (let index = 0; index < result.length; index += 1) {
      const current = result[index];
      const next = result[(index + 1) % result.length];
      if (distance(current, next) >= minimumEdge) {
        continue;
      }

      result.splice((index + 1) % result.length, 1);
      changed = true;
      break;
    }
  }

  changed = true;
  while (changed && result.length >= 3) {
    changed = false;

    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      const turn = localTurnStrength([previous, current, next], 1, 1);
      if (turn >= 0.22) {
        continue;
      }

      result.splice(index, 1);
      changed = true;
      break;
    }
  }

  return result;
}

function collapseOpenVertices(
  vertices: PointLike[],
  minimumEdge: number,
  closingGap: number,
): PointLike[] {
  let result = dedupeSequential(vertices);
  if (result.length < 3) {
    return result;
  }

  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;

    for (let index = 0; index < result.length - 1; index += 1) {
      if (distance(result[index], result[index + 1]) >= minimumEdge) {
        continue;
      }

      if (index === 0) {
        result.splice(1, 1);
      } else if (index === result.length - 2) {
        result.splice(index, 1);
      } else {
        result.splice(index + 1, 1);
      }
      changed = true;
      break;
    }
  }

  changed = true;
  while (changed && result.length >= 3) {
    changed = false;

    for (let index = 1; index < result.length - 1; index += 1) {
      const turn = localTurnStrength(
        [result[index - 1], result[index], result[index + 1]],
        1,
        1,
      );
      if (turn >= 0.22) {
        continue;
      }

      result.splice(index, 1);
      changed = true;
      break;
    }
  }

  if (result.length >= 4 && distance(result[0], result[result.length - 1]) <= closingGap) {
    const joint = midpoint(result[0], result[result.length - 1]);
    result = [joint].concat(result.slice(1, -1));
  }

  return result;
}

function simplifyClosedRing(
  ring: PointLike[],
  epsilon: number,
  minimumEdge: number,
): PointLike[] {
  if (ring.length < 3) {
    return [];
  }

  const closed = dedupeSequential(ring.concat([ring[0]]));
  const simplified = simplifyRdp(closed, epsilon);
  const withoutDuplicate =
    simplified.length >= 2 &&
    distance(simplified[0], simplified[simplified.length - 1]) <= minimumEdge * 1.4
      ? simplified.slice(0, -1)
      : simplified.slice();

  return collapseClosedVertices(withoutDuplicate, minimumEdge);
}

function fitSimplifiedOpenPolygon(
  path: PointLike[],
  ring: PointLike[],
  bounds: Bounds,
): {candidate: Candidate | null; vertexCount: number} {
  if (path.length < 6 || ring.length < 8) {
    return {candidate: null, vertexCount: 0};
  }

  const epsilons = [0.012, 0.018, 0.026, 0.036, 0.05, 0.06].map(scaleFactor =>
    Math.max(2.5, bounds.diagonal * scaleFactor),
  );
  const seen = new Set<string>();
  let bestCandidate: Candidate | null = null;
  let bestVertexCount = 0;
  const preferCandidate = (candidate: Candidate, vertexCount: number): void => {
    if (
      !bestCandidate ||
      candidate.score + 0.008 < bestCandidate.score ||
      (vertexCount < bestVertexCount && candidate.score <= bestCandidate.score + 0.018)
    ) {
      bestCandidate = candidate;
      bestVertexCount = vertexCount;
    }
  };

  for (const epsilon of epsilons) {
    const simplified = collapseOpenVertices(
      simplifyRdp(path, epsilon),
      Math.max(4, bounds.diagonal * 0.026),
      Math.max(bounds.diagonal * 0.32, 18),
    );
    if (simplified.length < 3 || simplified.length > 8) {
      continue;
    }

    const key = simplified
      .map(point => `${Math.round(point.x)}:${Math.round(point.y)}`)
      .join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const candidate = polygonCandidateFromVertices(ring, simplified, bounds);
    if (candidate) {
      preferCandidate(candidate, simplified.length);
    }

    if (
      simplified.length === 5 &&
      distance(path[0], path[path.length - 1]) <= Math.max(bounds.diagonal * 0.34, 18)
    ) {
      for (let index = 0; index < simplified.length; index += 1) {
        const reduced = simplified.slice(0, index).concat(simplified.slice(index + 1));
        const reducedCandidate = polygonCandidateFromVertices(ring, reduced, bounds);
        if (reducedCandidate) {
          preferCandidate(reducedCandidate, reduced.length);
        }
      }
    }

    if (
      !candidate &&
      distance(path[0], path[path.length - 1]) >= Math.max(bounds.diagonal * 0.55, 28) &&
      simplified.length >= 4 &&
      simplified.length <= 8
    ) {
      const hull = collapseClosedVertices(
        convexHull(simplified),
        Math.max(4, bounds.diagonal * 0.026),
      );
      const hullCandidate = polygonCandidateFromVertices(ring, hull, bounds);
      if (hullCandidate) {
        preferCandidate(hullCandidate, hull.length);
      }
    }
  }

  return {
    candidate: bestCandidate,
    vertexCount: bestVertexCount,
  };
}

function fitOpenHullPolygon(
  path: PointLike[],
  ring: PointLike[],
  bounds: Bounds,
): {candidate: Candidate | null; vertexCount: number} {
  if (path.length < 6) {
    return {candidate: null, vertexCount: 0};
  }

  const epsilons = [0.04, 0.05, 0.06].map(scaleFactor =>
    Math.max(4, bounds.diagonal * scaleFactor),
  );
  let bestCandidate: Candidate | null = null;
  let bestVertexCount = 0;

  for (const epsilon of epsilons) {
    const simplified = simplifyRdp(path, epsilon);
    if (simplified.length < 3) {
      continue;
    }

    const hull = collapseClosedVertices(
      convexHull(simplified),
      Math.max(4, bounds.diagonal * 0.026),
    );
    if (hull.length < 3 || hull.length > 8) {
      continue;
    }

    const candidate =
      hull.length === 3
        ? fitOpenTriangle(path, hull, bounds)
        : polygonCandidateFromVertices(ring, hull, bounds);
    if (!candidate) {
      continue;
    }

    if (
      !bestCandidate ||
      candidate.score + 0.008 < bestCandidate.score ||
      (hull.length < bestVertexCount && candidate.score <= bestCandidate.score + 0.018)
    ) {
      bestCandidate = candidate;
      bestVertexCount = hull.length;
    }
  }

  return {
    candidate: bestCandidate,
    vertexCount: bestVertexCount,
  };
}

function countSelfIntersections(points: PointLike[], closed: boolean): number {
  if (points.length < 4) {
    return 0;
  }

  const segmentCount = closed ? points.length : points.length - 1;
  let intersections = 0;

  for (let first = 0; first < segmentCount; first += 1) {
    const firstStart = points[first];
    const firstEnd = points[(first + 1) % points.length];

    for (let second = first + 1; second < segmentCount; second += 1) {
      if (Math.abs(first - second) <= 1) {
        continue;
      }

      if (closed && ((first === 0 && second === segmentCount - 1) || (second === 0 && first === segmentCount - 1))) {
        continue;
      }

      const secondStart = points[second];
      const secondEnd = points[(second + 1) % points.length];
      const intersection = segmentIntersection(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      );

      if (!intersection) {
        continue;
      }

      intersections += 1;
    }
  }

  return intersections;
}

function localTurnStrength(
  ring: PointLike[],
  index: number,
  window: number,
): number {
  const count = ring.length;
  const previous = ring[(index - window + count) % count];
  const current = ring[index];
  const next = ring[(index + window) % count];
  const incoming = normalize(subtract(previous, current));
  const outgoing = normalize(subtract(next, current));
  const angle = Math.acos(clamp(dot(incoming, outgoing), -1, 1));
  return Math.PI - angle;
}

function clusterCircularCorners(
  candidates: CircularCorner[],
  count: number,
  gap: number,
): CircularCorner[] {
  if (!candidates.length) {
    return [];
  }

  const sorted = candidates.slice().sort((left, right) => left.index - right.index);
  const groups: CircularCorner[][] = [[sorted[0]]];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.index - previous.index <= gap) {
      groups[groups.length - 1].push(current);
    } else {
      groups.push([current]);
    }
  }

  if (
    groups.length > 1 &&
    count - groups[groups.length - 1][groups[groups.length - 1].length - 1].index +
        groups[0][0].index <=
      gap
  ) {
    groups[0] = groups[groups.length - 1].concat(groups[0]);
    groups.pop();
  }

  return groups.map(group =>
    group.reduce((best, candidate) =>
      candidate.saliency > best.saliency ? candidate : best,
    ),
  );
}

function pruneCorners(
  candidates: CircularCorner[],
  count: number,
  minimumGap: number,
): CircularCorner[] {
  const corners = candidates.slice().sort((left, right) => left.index - right.index);

  while (corners.length >= 3) {
    let bestGap = Number.POSITIVE_INFINITY;
    let gapIndex = -1;

    for (let index = 0; index < corners.length; index += 1) {
      const current = corners[index];
      const next = corners[(index + 1) % corners.length];
      const gap =
        index === corners.length - 1
          ? count - current.index + next.index
          : next.index - current.index;

      if (gap < bestGap) {
        bestGap = gap;
        gapIndex = index;
      }
    }

    if (bestGap >= minimumGap || gapIndex < 0) {
      break;
    }

    const leftIndex = gapIndex;
    const rightIndex = (gapIndex + 1) % corners.length;
    const left = corners[leftIndex];
    const right = corners[rightIndex];

    if (left.saliency <= right.saliency) {
      corners.splice(leftIndex, 1);
    } else {
      corners.splice(rightIndex, 1);
    }
  }

  return corners;
}

function extractCorners(
  ring: PointLike[],
): {
  corners: CircularCorner[];
  meanTurn: number;
  meanSaliency: number;
} {
  if (ring.length < 12) {
    return {corners: [], meanTurn: 0, meanSaliency: 0};
  }

  const perimeter = pathLength(ring.concat([ring[0]]));
  const step = perimeter / Math.max(ring.length, 1);
  const window = clamp(Math.round(ring.length / 24), 2, 5);
  const strawArc = step * window * 2;

  const ratios = ring.map((_, index) => {
    const previous = ring[(index - window + ring.length) % ring.length];
    const next = ring[(index + window) % ring.length];
    return distance(previous, next) / Math.max(strawArc, 1);
  });
  const turns = ring.map((_, index) => localTurnStrength(ring, index, window));
  const medianRatio = median(ratios);
  const ratioThreshold = Math.min(0.985, medianRatio * 0.97);
  const turnThreshold = Math.max(0.38, mean(turns) * 1.15);
  const rawCandidates: CircularCorner[] = [];

  for (let index = 0; index < ring.length; index += 1) {
    const previous = ratios[(index - 1 + ring.length) % ring.length];
    const current = ratios[index];
    const next = ratios[(index + 1) % ring.length];
    const turn = turns[index];

    if (current > previous || current > next) {
      continue;
    }

    if (current > ratioThreshold || turn < turnThreshold) {
      continue;
    }

    rawCandidates.push({
      index,
      ratio: current,
      turn,
      saliency:
        (ratioThreshold - current) / Math.max(ratioThreshold, 0.0001) +
        (turn / Math.PI) * 0.6,
    });
  }

  if (!rawCandidates.length) {
    return {
      corners: [],
      meanTurn: mean(turns),
      meanSaliency: 0,
    };
  }

  const clustered = clusterCircularCorners(rawCandidates, ring.length, Math.max(2, window + 1));
  const pruned = pruneCorners(clustered, ring.length, Math.max(3, Math.round(ring.length / 12)));

  return {
    corners: pruned.sort((left, right) => left.index - right.index),
    meanTurn: mean(turns),
    meanSaliency: mean(pruned.map(corner => corner.saliency)),
  };
}

function arcPoints(
  ring: PointLike[],
  startIndex: number,
  endIndex: number,
): PointLike[] {
  if (startIndex <= endIndex) {
    return ring.slice(startIndex, endIndex + 1);
  }

  return ring.slice(startIndex).concat(ring.slice(0, endIndex + 1));
}

function fitLineModel(points: PointLike[]): {
  center: PointLike;
  direction: PointLike;
} {
  const axes = principalAxes(points);
  return {
    center: axes.center,
    direction: axes.majorAxis,
  };
}

function lineIntersection(
  left: {center: PointLike; direction: PointLike},
  right: {center: PointLike; direction: PointLike},
): PointLike | null {
  const denominator = cross(left.direction, right.direction);
  if (Math.abs(denominator) < 0.0001) {
    return null;
  }

  const offset = subtract(right.center, left.center);
  const leftScale = cross(offset, right.direction) / denominator;
  return add(left.center, scale(left.direction, leftScale));
}

function bestCyclicMeanDistance(left: PointLike[], right: PointLike[]): number {
  if (!left.length || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let best = Number.POSITIVE_INFINITY;

  for (const candidate of [right, right.slice().reverse()]) {
    for (let shift = 0; shift < candidate.length; shift += 1) {
      let total = 0;
      for (let index = 0; index < left.length; index += 1) {
        total += distance(left[index], candidate[(index + shift) % candidate.length]);
      }
      best = Math.min(best, total / left.length);
    }
  }

  return best;
}

function refinePolygonVertices(
  ring: PointLike[],
  cornerIndices: number[],
  bounds: Bounds,
): PointLike[] {
  const fittedEdges = cornerIndices.map((startIndex, index) =>
    fitLineModel(
      arcPoints(ring, startIndex, cornerIndices[(index + 1) % cornerIndices.length]),
    ),
  );

  return fittedEdges.map((edge, index) => {
    const previous = fittedEdges[
      (index - 1 + fittedEdges.length) % fittedEdges.length
    ];
    const intersection = lineIntersection(previous, edge);
    const fallback = ring[cornerIndices[index]];

    if (!intersection) {
      return fallback;
    }

    if (distance(intersection, fallback) > bounds.diagonal * 0.18) {
      return fallback;
    }

    return intersection;
  });
}

function fitLine(points: PointLike[], bounds: Bounds): Candidate | null {
  if (points.length < 2) {
    return null;
  }

  const axes = principalAxes(points);
  const projections = points.map(point => project(point, axes.majorAxis, axes.center));
  const orthogonal = points.map(point => project(point, axes.minorAxis, axes.center));
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const span = maxProjection - minProjection;
  const orthogonalError = Math.sqrt(
    orthogonal.reduce((sum, value) => sum + value * value, 0) /
      Math.max(orthogonal.length, 1),
  );
  const linearityRatio =
    axes.majorVariance / Math.max(axes.minorVariance, 0.0001);

  if (span / bounds.diagonal < 0.3 || linearityRatio < 16) {
    return null;
  }

  const start = {
    x: axes.center.x + axes.majorAxis.x * minProjection,
    y: axes.center.y + axes.majorAxis.y * minProjection,
  };
  const end = {
    x: axes.center.x + axes.majorAxis.x * maxProjection,
    y: axes.center.y + axes.majorAxis.y * maxProjection,
  };

  const score =
    orthogonalError / bounds.diagonal + 0.22 / Math.max(linearityRatio, 1);
  if (score > LINE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'line',
    score,
    geometry: {
      type: 'line',
      points: [start, end],
    },
  };
}

function averageEllipseBoundaryError(
  points: PointLike[],
  center: PointLike,
  majorAxis: PointLike,
  minorAxis: PointLike,
  majorRadius: number,
  minorRadius: number,
): number {
  if (!points.length) {
    return Number.POSITIVE_INFINITY;
  }

  let total = 0;
  for (const point of points) {
    const major = project(point, majorAxis, center);
    const minor = project(point, minorAxis, center);
    const normalizedRadius = Math.hypot(
      major / Math.max(majorRadius, 1),
      minor / Math.max(minorRadius, 1),
    );

    if (normalizedRadius < 0.0001) {
      total += Math.min(majorRadius, minorRadius);
      continue;
    }

    const boundaryMajor = major / normalizedRadius;
    const boundaryMinor = minor / normalizedRadius;
    total += Math.hypot(major - boundaryMajor, minor - boundaryMinor);
  }

  return total / points.length;
}

function fitCircle(points: PointLike[]): Candidate | null {
  if (points.length < 8) {
    return null;
  }

  const center = centroid(points);
  const distances = points.map(point => distance(point, center));
  const radius = mean(distances);
  const axes = principalAxes(points);
  const aligned = points.map(point => ({
    major: project(point, axes.majorAxis, axes.center),
    minor: project(point, axes.minorAxis, axes.center),
  }));
  const majorRadius = Math.max(...aligned.map(point => Math.abs(point.major)), 1);
  const minorRadius = Math.max(...aligned.map(point => Math.abs(point.minor)), 1);
  const axisRatio = majorRadius / Math.max(minorRadius, 1);
  const radialError =
    distances.reduce((sum, value) => sum + Math.abs(value - radius), 0) /
    Math.max(distances.length, 1);
  const score =
    (radialError / Math.max(radius, 1)) * 0.9 +
    Math.abs(axisRatio - 1) * 0.08;

  if (score > CURVE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'circle',
    score,
    geometry: {
      type: 'ellipse',
      center,
      majorRadius: radius,
      minorRadius: radius,
      angle: 0,
    },
  };
}

function fitEllipse(points: PointLike[]): Candidate | null {
  if (points.length < 8) {
    return null;
  }

  const axes = principalAxes(points);
  const aligned = points.map(point => ({
    major: project(point, axes.majorAxis, axes.center),
    minor: project(point, axes.minorAxis, axes.center),
  }));
  const majorRadius = Math.max(...aligned.map(point => Math.abs(point.major)), 1);
  const minorRadius = Math.max(...aligned.map(point => Math.abs(point.minor)), 1);
  const boundaryError = averageEllipseBoundaryError(
    points,
    axes.center,
    axes.majorAxis,
    axes.minorAxis,
    majorRadius,
    minorRadius,
  );
  const axisRatio = majorRadius / Math.max(minorRadius, 1);
  const score =
    (boundaryError / Math.max(Math.min(majorRadius, minorRadius), 1)) * 0.82 +
    Math.abs(axisRatio - 1) * 0.015;

  if (score > CURVE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'ellipse',
    score,
    geometry: {
      type: 'ellipse',
      center: axes.center,
      majorRadius,
      minorRadius,
      angle: Math.atan2(axes.majorAxis.y, axes.majorAxis.x),
    },
  };
}

function chooseCurveCandidate(
  circle: Candidate | null,
  ellipse: Candidate | null,
): Candidate | null {
  if (!circle && !ellipse) {
    return null;
  }

  if (!circle) {
    return ellipse;
  }

  if (!ellipse) {
    return circle;
  }

  const ellipseGeometry =
    ellipse.geometry.type === 'ellipse' ? ellipse.geometry : null;
  const axisRatio = ellipseGeometry
    ? ellipseGeometry.majorRadius / Math.max(ellipseGeometry.minorRadius, 1)
    : Number.POSITIVE_INFINITY;

  if (
    axisRatio <= CIRCLE_AXIS_RATIO_THRESHOLD &&
    circle.score <= ellipse.score + CIRCLE_PREFERENCE_MARGIN
  ) {
    return circle;
  }

  return circle.score < ellipse.score ? circle : ellipse;
}

function rectangleCorners(
  center: PointLike,
  majorAxis: PointLike,
  minorAxis: PointLike,
  halfWidth: number,
  halfHeight: number,
): PointLike[] {
  return [
    {
      x: center.x + majorAxis.x * halfWidth + minorAxis.x * halfHeight,
      y: center.y + majorAxis.y * halfWidth + minorAxis.y * halfHeight,
    },
    {
      x: center.x + majorAxis.x * halfWidth - minorAxis.x * halfHeight,
      y: center.y + majorAxis.y * halfWidth - minorAxis.y * halfHeight,
    },
    {
      x: center.x - majorAxis.x * halfWidth - minorAxis.x * halfHeight,
      y: center.y - majorAxis.y * halfWidth - minorAxis.y * halfHeight,
    },
    {
      x: center.x - majorAxis.x * halfWidth + minorAxis.x * halfHeight,
      y: center.y - majorAxis.y * halfWidth + minorAxis.y * halfHeight,
    },
  ];
}

function fitQuadrilateral(
  ring: PointLike[],
  corners: PointLike[],
  bounds: Bounds,
  asSquare: boolean,
): Candidate | null {
  if (corners.length !== 4) {
    return null;
  }

  const center = centroid(corners);
  const edge0 = normalize(subtract(corners[1], corners[0]));
  const edge1 = normalize(subtract(corners[2], corners[1]));
  const edge2 = normalize(subtract(corners[2], corners[3]));
  const edge3 = normalize(subtract(corners[3], corners[0]));
  let majorAxis = add(edge0, edge2);
  if (Math.hypot(majorAxis.x, majorAxis.y) < 0.2) {
    majorAxis = edge0;
  }
  majorAxis = normalize(majorAxis);

  const minorHint = add(edge1, edge3);
  let minorAxis = {
    x: -majorAxis.y,
    y: majorAxis.x,
  };
  if (dot(minorAxis, minorHint) < 0) {
    minorAxis = scale(minorAxis, -1);
  }

  const halfWidth = mean(
    corners.map(point => Math.abs(project(point, majorAxis, center))),
  );
  const halfHeight = mean(
    corners.map(point => Math.abs(project(point, minorAxis, center))),
  );
  const effectiveHalfWidth = asSquare ? (halfWidth + halfHeight) / 2 : halfWidth;
  const effectiveHalfHeight = asSquare
    ? (halfWidth + halfHeight) / 2
    : halfHeight;

  const rectangle = rectangleCorners(
    center,
    majorAxis,
    minorAxis,
    effectiveHalfWidth,
    effectiveHalfHeight,
  );
  const edgeError =
    averageDistanceToSegments(ring, buildPolygonSegments(rectangle)) /
    bounds.diagonal;
  const targetArea = polygonArea(rectangle);
  const sourceArea = polygonArea(ring);
  const coveragePenalty =
    Math.abs(sourceArea / Math.max(targetArea, 1) - 1) * 0.1;
  const cornerPenalty =
    (bestCyclicMeanDistance(corners, rectangle) / bounds.diagonal) * 0.32;
  const rightAnglePenalty =
    mean([
      Math.abs(dot(edge0, edge1)),
      Math.abs(dot(edge1, normalize(subtract(corners[3], corners[2])))),
      Math.abs(dot(normalize(subtract(corners[3], corners[2])), normalize(subtract(corners[0], corners[3])))),
      Math.abs(dot(normalize(subtract(corners[0], corners[3])), edge0)),
    ]) * 0.08;
  const aspectPenalty = asSquare
    ? (Math.abs(halfWidth - halfHeight) / Math.max(halfWidth, halfHeight)) * 0.34
    : 0;
  const score =
    edgeError + coveragePenalty + cornerPenalty + rightAnglePenalty + aspectPenalty;

  if (score > RECTANGLE_MAX_SCORE) {
    return null;
  }

  return {
    kind: asSquare ? 'square' : 'rectangle',
    score,
    geometry: {
      type: 'polygon',
      points: rectangle,
    },
  };
}

function fitTriangle(
  ring: PointLike[],
  corners: PointLike[],
  bounds: Bounds,
): Candidate | null {
  if (corners.length !== 3) {
    return null;
  }

  const edgeError =
    averageDistanceToSegments(ring, buildPolygonSegments(corners)) /
    bounds.diagonal;
  const score = edgeError;

  if (score > TRIANGLE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'triangle',
    score,
    geometry: {
      type: 'polygon',
      points: corners,
    },
  };
}

function fitOpenTriangle(
  path: PointLike[],
  corners: PointLike[],
  bounds: Bounds,
): Candidate | null {
  if (corners.length !== 3) {
    return null;
  }

  const edgeError =
    averageDistanceToSegments(path, buildPolygonSegments(corners)) /
    bounds.diagonal;
  const score = edgeError;

  if (score > TRIANGLE_MAX_SCORE * 1.15) {
    return null;
  }

  return {
    kind: 'triangle',
    score,
    geometry: {
      type: 'polygon',
      points: corners,
    },
  };
}

function fitChordTriangle(
  path: PointLike[],
  bounds: Bounds,
): Candidate | null {
  if (path.length < 5) {
    return null;
  }

  const start = path[0];
  const end = path[path.length - 1];
  let bestPoint: PointLike | null = null;
  let bestDistance = 0;

  for (let index = 1; index < path.length - 1; index += 1) {
    const currentDistance = distanceToSegment(path[index], start, end);
    if (currentDistance > bestDistance) {
      bestDistance = currentDistance;
      bestPoint = path[index];
    }
  }

  if (!bestPoint || bestDistance / Math.max(bounds.diagonal, 1) < 0.18) {
    return null;
  }

  return fitOpenTriangle(path, [start, bestPoint, end], bounds);
}

function polygonKindForSides(sides: number): ShapeKind | null {
  switch (sides) {
    case 5:
      return 'pentagon';
    case 6:
      return 'hexagon';
    case 7:
      return 'heptagon';
    case 8:
      return 'octagon';
    default:
      return null;
  }
}

function regularPolygonFromCorners(corners: PointLike[]): PointLike[] {
  const kind = polygonKindForSides(corners.length);
  if (!kind) {
    return [];
  }

  const center = centroid(corners);
  const step = (Math.PI * 2) / corners.length;
  const clockwise = signedPolygonArea(corners) < 0;
  const direction = clockwise ? -1 : 1;
  const baseAngles = corners.map((corner, index) => {
    const angle = Math.atan2(corner.y - center.y, corner.x - center.x);
    return angle - direction * step * index;
  });
  const meanVector = baseAngles.reduce(
    (accumulator, value) => ({
      x: accumulator.x + Math.cos(value),
      y: accumulator.y + Math.sin(value),
    }),
    {x: 0, y: 0},
  );
  const baseAngle = Math.atan2(meanVector.y, meanVector.x);
  const radius = mean(corners.map(point => distance(point, center)));

  return Array.from({length: corners.length}, (_, index) => ({
    x: center.x + Math.cos(baseAngle + direction * step * index) * radius,
    y: center.y + Math.sin(baseAngle + direction * step * index) * radius,
  }));
}

function fitRegularPolygon(
  ring: PointLike[],
  corners: PointLike[],
  bounds: Bounds,
): Candidate | null {
  const kind = polygonKindForSides(corners.length);
  if (!kind) {
    return null;
  }

  const polygon = regularPolygonFromCorners(corners);
  if (!polygon.length) {
    return null;
  }

  const edgeError =
    averageDistanceToSegments(ring, buildPolygonSegments(polygon)) /
    bounds.diagonal;
  const cornerPenalty =
    (bestCyclicMeanDistance(corners, polygon) / bounds.diagonal) * 0.35;
  const score = edgeError + cornerPenalty;

  if (score > POLYGON_MAX_SCORE) {
    return null;
  }

  return {
    kind,
    score,
    geometry: {
      type: 'polygon',
      points: polygon,
    },
  };
}

function chooseQuadrilateralCandidate(
  rectangleCandidate: Candidate | null,
  squareCandidate: Candidate | null,
): Candidate | null {
  return squareCandidate &&
    rectangleCandidate &&
    squareCandidate.score <= rectangleCandidate.score + SQUARE_PREFERENCE_MARGIN
    ? squareCandidate
    : squareCandidate && rectangleCandidate
      ? squareCandidate.score < rectangleCandidate.score
        ? squareCandidate
        : rectangleCandidate
      : squareCandidate ?? rectangleCandidate;
}

function polygonCandidateFromVertices(
  ring: PointLike[],
  corners: PointLike[],
  bounds: Bounds,
): Candidate | null {
  if (corners.length === 3) {
    return fitTriangle(ring, corners, bounds);
  }

  if (corners.length === 4) {
    return chooseQuadrilateralCandidate(
      fitQuadrilateral(ring, corners, bounds, false),
      fitQuadrilateral(ring, corners, bounds, true),
    );
  }

  if (corners.length >= 5 && corners.length <= 8) {
    return fitRegularPolygon(ring, corners, bounds);
  }

  return null;
}

function fitSimplifiedPolygon(
  ring: PointLike[],
  bounds: Bounds,
): {candidate: Candidate | null; vertexCount: number} {
  if (ring.length < 8) {
    return {candidate: null, vertexCount: 0};
  }

  const epsilons = [0.014, 0.02, 0.028, 0.038, 0.05].map(scaleFactor =>
    Math.max(3, bounds.diagonal * scaleFactor),
  );
  const seen = new Set<string>();
  let bestCandidate: Candidate | null = null;
  let bestVertexCount = 0;
  const preferCandidate = (candidate: Candidate, vertexCount: number): void => {
    if (
      !bestCandidate ||
      candidate.score + 0.008 < bestCandidate.score ||
      (vertexCount < bestVertexCount && candidate.score <= bestCandidate.score + 0.018)
    ) {
      bestCandidate = candidate;
      bestVertexCount = vertexCount;
    }
  };

  for (const epsilon of epsilons) {
    const simplified = simplifyClosedRing(
      ring,
      epsilon,
      Math.max(4, bounds.diagonal * 0.028),
    );
    if (simplified.length < 3 || simplified.length > 8) {
      continue;
    }

    const key = simplified
      .map(point => `${Math.round(point.x)}:${Math.round(point.y)}`)
      .join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const candidate = polygonCandidateFromVertices(ring, simplified, bounds);
    if (!candidate) {
      continue;
    }

    preferCandidate(candidate, simplified.length);
  }

  return {
    candidate: bestCandidate,
    vertexCount: bestVertexCount,
  };
}

function chooseBetweenCurveAndPolygon(
  curveCandidate: Candidate | null,
  polygonCandidate: Candidate | null,
  meanSaliency: number,
  meanTurn: number,
): Candidate | null {
  if (!curveCandidate) {
    return polygonCandidate;
  }

  if (!polygonCandidate) {
    return curveCandidate;
  }

  const polygonHasStrongCorners =
    meanSaliency >= STRONG_CORNER_SALIENCY && meanTurn >= STRONG_CORNER_TURN;

  if (
    polygonHasStrongCorners &&
    polygonCandidate.score + POLYGON_OVER_CURVE_MARGIN < curveCandidate.score
  ) {
    return polygonCandidate;
  }

  if (curveCandidate.score <= polygonCandidate.score + CURVE_OVER_POLYGON_MARGIN) {
    return curveCandidate;
  }

  return polygonCandidate;
}

function normalizeAxisAngle(angle: number): number {
  let normalized = angle % Math.PI;
  if (normalized < 0) {
    normalized += Math.PI;
  }
  return normalized;
}

function shortestAxisDelta(angle: number, target: number): number {
  const normalizedAngle = normalizeAxisAngle(angle);
  const normalizedTarget = normalizeAxisAngle(target);
  let delta = normalizedTarget - normalizedAngle;
  if (delta > Math.PI / 2) {
    delta -= Math.PI;
  } else if (delta < -Math.PI / 2) {
    delta += Math.PI;
  }
  return delta;
}

function chooseOrientationSnapDelta(angles: number[]): number | null {
  const chooseBestDelta = (target: number): number | null => {
    let bestDelta: number | null = null;

    for (const angle of angles) {
      const delta = shortestAxisDelta(angle, target);
      if (Math.abs(delta) > ORIENTATION_SNAP_THRESHOLD) {
        continue;
      }

      if (bestDelta === null || Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
      }
    }

    return bestDelta;
  };

  const horizontalDelta = chooseBestDelta(0);
  if (horizontalDelta !== null) {
    return horizontalDelta;
  }

  return chooseBestDelta(Math.PI / 2);
}

function rotatePointAround(
  point: PointLike,
  center: PointLike,
  angle: number,
): PointLike {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const offset = subtract(point, center);

  return {
    x: center.x + offset.x * cosine - offset.y * sine,
    y: center.y + offset.x * sine + offset.y * cosine,
  };
}

function maybeSnapGeometryOrientation(
  kind: ShapeKind,
  geometry: GeometryDescriptor,
): GeometryDescriptor {
  if (kind === 'circle') {
    return geometry;
  }

  if (geometry.type === 'line') {
    const [start, end] = geometry.points;
    const delta = chooseOrientationSnapDelta([
      Math.atan2(end.y - start.y, end.x - start.x),
    ]);
    if (delta === null) {
      return geometry;
    }

    const center = midpoint(start, end);
    return {
      type: 'line',
      points: [
        rotatePointAround(start, center, delta),
        rotatePointAround(end, center, delta),
      ],
    };
  }

  if (geometry.type === 'ellipse') {
    const delta = chooseOrientationSnapDelta([
      geometry.angle,
      geometry.angle + Math.PI / 2,
    ]);
    if (delta === null) {
      return geometry;
    }

    return {
      ...geometry,
      angle: normalizeAxisAngle(geometry.angle + delta),
    };
  }

  if (geometry.type === 'polygon') {
    const edges = geometry.points
      .map((point, index) => [point, geometry.points[(index + 1) % geometry.points.length]] as const)
      .filter(([start, end]) => distance(start, end) > 1);
    const delta = chooseOrientationSnapDelta(
      edges.map(([start, end]) => Math.atan2(end.y - start.y, end.x - start.x)),
    );
    if (delta === null) {
      return geometry;
    }

    const center = centroid(geometry.points);
    return {
      type: 'polygon',
      points: geometry.points.map(point => rotatePointAround(point, center, delta)),
    };
  }

  return geometry;
}

function shapeFromCandidate(
  candidate: Candidate,
  closureGap: number,
  fillRatio: number,
  cornerCount: number,
): ShapeMatch {
  return {
    kind: candidate.kind,
    score: candidate.score,
    geometry: maybeSnapGeometryOrientation(candidate.kind, candidate.geometry),
    diagnostics: {
      closureGap,
      fillRatio,
      simplifiedVertexCount: cornerCount,
    },
  };
}

export function debugDetectShape(input: ShapeDetectionInput): ShapeDebugInfo | null {
  const recognitionNames = (input.recognitionNames ?? [])
    .map(name => name.trim())
    .filter(Boolean);

  if (containsTextSignal(recognitionNames)) {
    return {
      reason: 'text-signal',
      closureGap: 0,
      fillRatio: 0,
      inkDensity: 0,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const strokePaths = (
    input.strokePaths?.length ? input.strokePaths : [input.samplePoints]
  )
    .map(path => dedupeSequential(path))
    .filter(path => path.length >= 2);

  const samplePoints = uniquePoints(
    dedupeSequential(
      flattenPoints(strokePaths).length ? flattenPoints(strokePaths) : input.samplePoints,
    ),
  );

  if (samplePoints.length < MIN_COMPONENT_POINTS || !strokePaths.length) {
    return null;
  }

  if (strokePaths.length > MAX_STROKES) {
    return {
      reason: 'too-many-strokes',
      closureGap: 0,
      fillRatio: 0,
      inkDensity: 0,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const sourceBounds = buildBounds(samplePoints);
  if (
    Math.max(sourceBounds.width, sourceBounds.height) < MIN_COMPONENT_SIZE ||
    Math.min(sourceBounds.width, sourceBounds.height) < 4
  ) {
    return {
      reason: 'too-small',
      closureGap: 0,
      fillRatio: 0,
      inkDensity: 0,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const spacing = clamp(sourceBounds.diagonal / 52, 3, 8);
  const resampledPaths = strokePaths.map(path => resamplePolyline(path, spacing, false));
  const mergedPath = stitchStrokePaths(
    resampledPaths,
    Math.max(spacing * 2.5, sourceBounds.diagonal * 0.09),
  );
  if (mergedPath.length < MIN_COMPONENT_POINTS) {
    return {
      reason: 'merged-too-short',
      closureGap: 0,
      fillRatio: 0,
      inkDensity: 0,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const trimmedPath = trimClosingTails(
    mergedPath,
    Math.max(spacing * 2.2, sourceBounds.diagonal * 0.08),
  );
  if (trimmedPath.length < MIN_COMPONENT_POINTS) {
    return {
      reason: 'trimmed-too-short',
      closureGap: 0,
      fillRatio: 0,
      inkDensity: 0,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const bounds = buildBounds(trimmedPath);
  const totalInkLength = pathLength(trimmedPath);
  const inkDensity = totalInkLength / Math.max(bounds.diagonal, 1);
  if (inkDensity > MAX_INK_DENSITY) {
    return {
      reason: 'too-dense',
      closureGap: 0,
      fillRatio: 0,
      inkDensity,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const selfIntersections = countSelfIntersections(trimmedPath, false);
  if (selfIntersections > MAX_OPEN_SELF_INTERSECTIONS) {
    return {
      reason: 'self-intersections',
      closureGap: 0,
      fillRatio: 0,
      inkDensity,
      canBeClosed: false,
      lineCandidate: null,
      curveCandidate: null,
      extractedCornerCount: 0,
      extractedMeanSaliency: 0,
      extractedMeanTurn: 0,
      simplifiedClosedCandidate: null,
      simplifiedClosedVertexCount: 0,
      simplifiedOpenCandidate: null,
      simplifiedOpenVertexCount: 0,
      openHullCandidate: null,
      openHullVertexCount: 0,
    };
  }

  const closureGap =
    distance(trimmedPath[0], trimmedPath[trimmedPath.length - 1]) /
    Math.max(bounds.diagonal, 1);
  const provisionalClosed =
    strokePaths.length > 1 ||
    closureGap <= CLOSED_GAP_THRESHOLD ||
    inkDensity >= MIN_CLOSED_DENSITY;
  const forcedClosedRing = resamplePolyline(trimmedPath, spacing, true);
  const closedRing = provisionalClosed ? forcedClosedRing : [];
  const fillRatio =
    closedRing.length >= 3 ? polygonArea(closedRing) / Math.max(bounds.area, 1) : 0;
  const canBeClosed = provisionalClosed || fillRatio >= MIN_FILL_RATIO * 1.4;
  const lineCandidate = fitLine(
    resamplePolyline(trimmedPath, spacing, false),
    bounds,
  );
  const forcedRingValid =
    forcedClosedRing.length >= 10 &&
    countSelfIntersections(forcedClosedRing, true) <= MAX_CLOSED_SELF_INTERSECTIONS;
  const openPathForFallback =
    strokePaths.length === 1 ? strokePaths[0] : mergedPath;
  const simplifiedClosed = forcedRingValid
    ? fitSimplifiedPolygon(forcedClosedRing, bounds)
    : {candidate: null, vertexCount: 0};
  const simplifiedOpen = forcedRingValid
    ? fitSimplifiedOpenPolygon(openPathForFallback, forcedClosedRing, bounds)
    : {candidate: null, vertexCount: 0};
  const openHull =
    forcedRingValid && closureGap >= OPEN_POLYGON_MAX_GAP * 0.6
      ? fitOpenHullPolygon(openPathForFallback, forcedClosedRing, bounds)
      : {candidate: null, vertexCount: 0};

  let extractedCornerCount = 0;
  let extractedMeanSaliency = 0;
  let extractedMeanTurn = 0;
  let curveCandidate: Candidate | null = null;

  if (closedRing.length >= 10) {
    const ringSelfIntersections = countSelfIntersections(closedRing, true);
    if (ringSelfIntersections <= MAX_CLOSED_SELF_INTERSECTIONS) {
      const extracted = extractCorners(closedRing);
      extractedCornerCount = extracted.corners.length;
      extractedMeanSaliency = extracted.meanSaliency;
      extractedMeanTurn = extracted.meanTurn;
      const circleCandidate =
        fillRatio >= MIN_FILL_RATIO ? fitCircle(closedRing) : null;
      const ellipseCandidate =
        fillRatio >= MIN_FILL_RATIO ? fitEllipse(closedRing) : null;
      curveCandidate = chooseCurveCandidate(circleCandidate, ellipseCandidate);
    }
  }

  return {
    reason: null,
    closureGap,
    fillRatio,
    inkDensity,
    canBeClosed,
    lineCandidate: lineCandidate?.kind ?? null,
    curveCandidate: curveCandidate?.kind ?? null,
    extractedCornerCount,
    extractedMeanSaliency,
    extractedMeanTurn,
    simplifiedClosedCandidate: simplifiedClosed.candidate?.kind ?? null,
    simplifiedClosedVertexCount: simplifiedClosed.vertexCount,
    simplifiedOpenCandidate: simplifiedOpen.candidate?.kind ?? null,
    simplifiedOpenVertexCount: simplifiedOpen.vertexCount,
    openHullCandidate: openHull.candidate?.kind ?? null,
    openHullVertexCount: openHull.vertexCount,
  };
}

export function detectBestShape(input: ShapeDetectionInput): ShapeMatch | null {
  const recognitionNames = (input.recognitionNames ?? [])
    .map(name => name.trim())
    .filter(Boolean);

  if (containsTextSignal(recognitionNames)) {
    return null;
  }

  const strokePaths = (
    input.strokePaths?.length ? input.strokePaths : [input.samplePoints]
  )
    .map(path => dedupeSequential(path))
    .filter(path => path.length >= 2);

  const samplePoints = uniquePoints(
    dedupeSequential(flattenPoints(strokePaths).length ? flattenPoints(strokePaths) : input.samplePoints),
  );

  if (samplePoints.length < MIN_COMPONENT_POINTS || !strokePaths.length) {
    return null;
  }

  if (strokePaths.length > MAX_STROKES) {
    return null;
  }

  const sourceBounds = buildBounds(samplePoints);
  if (
    Math.max(sourceBounds.width, sourceBounds.height) < MIN_COMPONENT_SIZE ||
    Math.min(sourceBounds.width, sourceBounds.height) < 4
  ) {
    return null;
  }

  const spacing = clamp(sourceBounds.diagonal / 52, 3, 8);
  const resampledPaths = strokePaths.map(path => resamplePolyline(path, spacing, false));
  const mergedPath = stitchStrokePaths(
    resampledPaths,
    Math.max(spacing * 2.5, sourceBounds.diagonal * 0.09),
  );

  if (mergedPath.length < MIN_COMPONENT_POINTS) {
    return null;
  }

  const trimmedPath = trimClosingTails(
    mergedPath,
    Math.max(spacing * 2.2, sourceBounds.diagonal * 0.08),
  );
  if (trimmedPath.length < MIN_COMPONENT_POINTS) {
    return null;
  }

  const bounds = buildBounds(trimmedPath);
  const totalInkLength = pathLength(trimmedPath);
  const inkDensity = totalInkLength / Math.max(bounds.diagonal, 1);
  if (inkDensity > MAX_INK_DENSITY) {
    return null;
  }

  const selfIntersections = countSelfIntersections(trimmedPath, false);
  if (selfIntersections > MAX_OPEN_SELF_INTERSECTIONS) {
    return null;
  }

  const closureGap =
    distance(trimmedPath[0], trimmedPath[trimmedPath.length - 1]) /
    Math.max(bounds.diagonal, 1);

  const provisionalClosed =
    strokePaths.length > 1 ||
    closureGap <= CLOSED_GAP_THRESHOLD ||
    inkDensity >= MIN_CLOSED_DENSITY;

  const forcedClosedRing = resamplePolyline(trimmedPath, spacing, true);
  const closedRing = provisionalClosed
    ? forcedClosedRing
    : [];
  const fillRatio =
    closedRing.length >= 3 ? polygonArea(closedRing) / Math.max(bounds.area, 1) : 0;
  const canBeClosed = provisionalClosed || fillRatio >= MIN_FILL_RATIO * 1.4;

  const lineCandidate = fitLine(
    resamplePolyline(trimmedPath, spacing, false),
    bounds,
  );
  const forcedRingValid =
    forcedClosedRing.length >= 10 &&
    countSelfIntersections(forcedClosedRing, true) <= MAX_CLOSED_SELF_INTERSECTIONS;
  const openPathForFallback =
    strokePaths.length === 1 ? strokePaths[0] : mergedPath;
  const simplifiedPolygon = forcedRingValid
    ? fitSimplifiedPolygon(forcedClosedRing, bounds)
    : {candidate: null, vertexCount: 0};
  const simplifiedOpenPolygon = forcedRingValid
    ? fitSimplifiedOpenPolygon(openPathForFallback, forcedClosedRing, bounds)
    : {candidate: null, vertexCount: 0};
  const openHullPolygon =
    forcedRingValid && closureGap >= OPEN_POLYGON_MAX_GAP * 0.6
      ? fitOpenHullPolygon(openPathForFallback, forcedClosedRing, bounds)
      : {candidate: null, vertexCount: 0};
  const chordTriangleCandidate =
    closureGap >= OPEN_POLYGON_MAX_GAP * 0.6
      ? {
          candidate: fitChordTriangle(
            openPathForFallback,
            buildBounds(openPathForFallback),
          ),
          vertexCount: 3,
        }
      : {candidate: null, vertexCount: 0};
  const simplifiedFallback =
    chordTriangleCandidate.candidate &&
    (!openHullPolygon.candidate ||
      chordTriangleCandidate.candidate.score <= openHullPolygon.candidate.score + 0.01)
      ? chordTriangleCandidate
      : openHullPolygon.candidate &&
        (!simplifiedOpenPolygon.candidate ||
          openHullPolygon.candidate.score <= simplifiedOpenPolygon.candidate.score + 0.006)
        ? openHullPolygon
      : simplifiedOpenPolygon.candidate
        ? simplifiedOpenPolygon
        : simplifiedPolygon.candidate
          ? simplifiedPolygon
          : chordTriangleCandidate.candidate
            ? chordTriangleCandidate
            : openHullPolygon.candidate
              ? openHullPolygon
            : simplifiedOpenPolygon.candidate
              ? simplifiedOpenPolygon
              : simplifiedPolygon;

  if (!canBeClosed) {
    if (
      simplifiedFallback.candidate &&
      closureGap <= OPEN_POLYGON_MAX_GAP &&
      !lineCandidate
    ) {
      return shapeFromCandidate(
        simplifiedFallback.candidate,
        closureGap,
        polygonArea(forcedClosedRing) / Math.max(bounds.area, 1),
        simplifiedFallback.vertexCount,
      );
    }

    if (!lineCandidate) {
      return null;
    }

    return shapeFromCandidate(lineCandidate, closureGap, fillRatio, 0);
  }

  if (fillRatio < MIN_FILL_RATIO && !lineCandidate && !simplifiedFallback.candidate) {
    return null;
  }

  if (closedRing.length < 10) {
    if (simplifiedFallback.candidate) {
      return shapeFromCandidate(
        simplifiedFallback.candidate,
        closureGap,
        polygonArea(forcedClosedRing) / Math.max(bounds.area, 1),
        simplifiedFallback.vertexCount,
      );
    }

    return null;
  }

  const ringSelfIntersections = countSelfIntersections(closedRing, true);
  if (ringSelfIntersections > MAX_CLOSED_SELF_INTERSECTIONS) {
    if (simplifiedFallback.candidate) {
      return shapeFromCandidate(
        simplifiedFallback.candidate,
        closureGap,
        fillRatio,
        simplifiedFallback.vertexCount,
      );
    }

    return null;
  }

  const extracted = extractCorners(closedRing);
  const cornerIndices = extracted.corners.map(corner => corner.index);
  const refinedCorners =
    cornerIndices.length >= 3
      ? refinePolygonVertices(closedRing, cornerIndices, bounds)
      : [];

      const circleCandidate =
        fillRatio >= MIN_FILL_RATIO ? fitCircle(closedRing) : null;
  const ellipseCandidate =
    fillRatio >= MIN_FILL_RATIO ? fitEllipse(closedRing) : null;
  const curveCandidate = chooseCurveCandidate(circleCandidate, ellipseCandidate);
  const extractedPolygonCandidate = polygonCandidateFromVertices(
    closedRing,
    refinedCorners,
    bounds,
  );
  const bestPolygonCandidate =
    extractedPolygonCandidate &&
    simplifiedFallback.candidate &&
    simplifiedFallback.candidate.score + 0.025 < extractedPolygonCandidate.score
      ? simplifiedFallback.candidate
      : extractedPolygonCandidate ?? simplifiedFallback.candidate;
  const bestPolygonCornerCount =
    bestPolygonCandidate === simplifiedFallback.candidate &&
    simplifiedFallback.candidate !== null
      ? simplifiedFallback.vertexCount
      : extractedPolygonCandidate
        ? cornerIndices.length
        : 0;

  if (cornerIndices.length <= 2) {
    const fallbackCandidate = chooseBetweenCurveAndPolygon(
      curveCandidate,
      simplifiedFallback.candidate,
      extracted.meanSaliency,
      extracted.meanTurn,
    );

    if (!fallbackCandidate) {
      return null;
    }

    return shapeFromCandidate(
      fallbackCandidate,
      closureGap,
      fillRatio,
      fallbackCandidate === simplifiedFallback.candidate
        ? simplifiedFallback.vertexCount
        : cornerIndices.length,
    );
  }

  if (curveCandidate && extracted.meanSaliency < 0.24) {
    return shapeFromCandidate(
      curveCandidate,
      closureGap,
      fillRatio,
      cornerIndices.length,
    );
  }

  const finalCandidate = chooseBetweenCurveAndPolygon(
    curveCandidate,
    bestPolygonCandidate,
    extracted.meanSaliency,
    extracted.meanTurn,
  );
  if (finalCandidate) {
    return shapeFromCandidate(
      finalCandidate,
      closureGap,
      fillRatio,
      finalCandidate === bestPolygonCandidate
        ? bestPolygonCornerCount
        : cornerIndices.length,
    );
  }

  return null;
}
