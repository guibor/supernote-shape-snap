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
  family: 'line' | 'ellipse' | 'rectangle' | 'polygon';
  geometry: GeometryDescriptor;
};

const MIN_COMPONENT_POINTS = 6;
const MIN_COMPONENT_SIZE = 18;
const LINE_MAX_SCORE = 0.035;
const SHAPE_MAX_SCORE = 0.1;
const CIRCLE_PREFERENCE_MARGIN = 0.012;
const SQUARE_PREFERENCE_MARGIN = 0.015;
const HULL_SIMPLIFY_FACTOR = 0.055;
const PATH_SIMPLIFY_FACTOR = 0.02;
const MIN_FILL_RATIO = 0.08;
const COLLINEAR_ANGLE_THRESHOLD = (24 * Math.PI) / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function square(value: number): number {
  return value * value;
}

function distance(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

  if (lengthSquared === 0) {
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

function closeRing(points: PointLike[]): PointLike[] {
  if (!points.length) {
    return [];
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) < 0.5) {
    return points.slice();
  }

  return points.concat([{...first}]);
}

function perpendicularDistance(
  point: PointLike,
  start: PointLike,
  end: PointLike,
): number {
  return distanceToSegment(point, start, end);
}

function simplifyDouglasPeucker(
  points: PointLike[],
  tolerance: number,
): PointLike[] {
  if (points.length <= 2) {
    return points.slice();
  }

  let maxDistance = -1;
  let maxIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentDistance = perpendicularDistance(
      points[index],
      points[0],
      points[points.length - 1],
    );
    if (currentDistance > maxDistance) {
      maxDistance = currentDistance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[points.length - 1]];
  }

  const left = simplifyDouglasPeucker(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyDouglasPeucker(points.slice(maxIndex), tolerance);

  return left.slice(0, -1).concat(right);
}

function simplifyClosedPolygon(
  points: PointLike[],
  tolerance: number,
  diagonal: number,
): PointLike[] {
  if (points.length <= 3) {
    return points.slice();
  }

  const ring = closeRing(points);
  const open = ring.slice(0, -1);
  const simplified = simplifyDouglasPeucker(open, tolerance);
  return mergeCollinearVertices(simplified, diagonal);
}

function mergeCollinearVertices(
  points: PointLike[],
  diagonal: number,
): PointLike[] {
  if (points.length <= 3) {
    return points.slice();
  }

  const result = points.slice();
  const minimumEdgeLength = Math.max(diagonal * 0.03, 8);

  let changed = true;
  while (changed && result.length > 3) {
    changed = false;

    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];

      const vectorA = {x: current.x - previous.x, y: current.y - previous.y};
      const vectorB = {x: next.x - current.x, y: next.y - current.y};
      const lengthA = Math.hypot(vectorA.x, vectorA.y);
      const lengthB = Math.hypot(vectorB.x, vectorB.y);

      if (lengthA < minimumEdgeLength || lengthB < minimumEdgeLength) {
        result.splice(index, 1);
        changed = true;
        break;
      }

      const normalizedDot =
        (vectorA.x * vectorB.x + vectorA.y * vectorB.y) /
        Math.max(lengthA * lengthB, 1);
      const angle = Math.acos(clamp(normalizedDot, -1, 1));
      const localTriangleArea = Math.abs(
        previous.x * (current.y - next.y) +
          current.x * (next.y - previous.y) +
          next.x * (previous.y - current.y),
      ) / 2;

      if (
        Math.abs(Math.PI - angle) <= COLLINEAR_ANGLE_THRESHOLD ||
        localTriangleArea <= diagonal * diagonal * 0.0025
      ) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }

  return result;
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

  if (span / bounds.diagonal < 0.25 || linearityRatio < 18) {
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
    orthogonalError / bounds.diagonal + 1 / Math.max(linearityRatio, 1) * 0.2;

  if (score > LINE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'line',
    family: 'line',
    score,
    geometry: {
      type: 'line',
      points: [start, end],
    },
  };
}

function fitCircle(points: PointLike[], bounds: Bounds): Candidate | null {
  if (points.length < 6) {
    return null;
  }

  const center = centroid(points);
  const distances = points.map(point => distance(point, center));
  const radius =
    distances.reduce((sum, value) => sum + value, 0) /
    Math.max(distances.length, 1);
  const radialError =
    distances.reduce((sum, value) => sum + Math.abs(value - radius), 0) /
    Math.max(distances.length, 1);
  const anisotropy =
    Math.abs(bounds.width - bounds.height) /
    Math.max(bounds.width, bounds.height);
  const score =
    (radialError / Math.max(radius, 1)) * 0.85 + anisotropy * 0.16;

  if (score > SHAPE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'circle',
    family: 'ellipse',
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

function fitEllipse(points: PointLike[], bounds: Bounds): Candidate | null {
  if (points.length < 6) {
    return null;
  }

  const axes = principalAxes(points);
  const aligned = points.map(point => ({
    major: project(point, axes.majorAxis, axes.center),
    minor: project(point, axes.minorAxis, axes.center),
  }));
  const majorRadius = Math.max(
    ...aligned.map(point => Math.abs(point.major)),
    1,
  );
  const minorRadius = Math.max(
    ...aligned.map(point => Math.abs(point.minor)),
    1,
  );
  const boundaryError = averageEllipseBoundaryError(
    points,
    axes.center,
    axes.majorAxis,
    axes.minorAxis,
    majorRadius,
    minorRadius,
  );
  const score =
    (boundaryError / Math.max(Math.min(majorRadius, minorRadius), 1)) * 0.8;

  if (score > SHAPE_MAX_SCORE) {
    return null;
  }

  return {
    kind: 'ellipse',
    family: 'ellipse',
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

function rectangleCorners(
  center: PointLike,
  majorAxis: PointLike,
  minorAxis: PointLike,
  halfWidth: number,
  halfHeight: number,
): PointLike[] {
  const topRight = {
    x: center.x + majorAxis.x * halfWidth + minorAxis.x * halfHeight,
    y: center.y + majorAxis.y * halfWidth + minorAxis.y * halfHeight,
  };
  const bottomRight = {
    x: center.x + majorAxis.x * halfWidth - minorAxis.x * halfHeight,
    y: center.y + majorAxis.y * halfWidth - minorAxis.y * halfHeight,
  };
  const bottomLeft = {
    x: center.x - majorAxis.x * halfWidth - minorAxis.x * halfHeight,
    y: center.y - majorAxis.y * halfWidth - minorAxis.y * halfHeight,
  };
  const topLeft = {
    x: center.x - majorAxis.x * halfWidth + minorAxis.x * halfHeight,
    y: center.y - majorAxis.y * halfWidth + minorAxis.y * halfHeight,
  };

  return [topRight, bottomRight, bottomLeft, topLeft];
}

function fitRectangle(
  points: PointLike[],
  bounds: Bounds,
  asSquare: boolean,
): Candidate | null {
  if (points.length < 4) {
    return null;
  }

  const axes = principalAxes(points);
  const aligned = points.map(point => ({
    major: project(point, axes.majorAxis, axes.center),
    minor: project(point, axes.minorAxis, axes.center),
  }));
  const halfWidth = Math.max(...aligned.map(point => Math.abs(point.major)), 1);
  const halfHeight = Math.max(...aligned.map(point => Math.abs(point.minor)), 1);
  const effectiveHalfWidth = asSquare ? (halfWidth + halfHeight) / 2 : halfWidth;
  const effectiveHalfHeight = asSquare
    ? (halfWidth + halfHeight) / 2
    : halfHeight;
  const corners = rectangleCorners(
    axes.center,
    axes.majorAxis,
    axes.minorAxis,
    effectiveHalfWidth,
    effectiveHalfHeight,
  );
  const edgeError =
    averageDistanceToSegments(points, buildPolygonSegments(corners)) /
    bounds.diagonal;
  const targetArea = polygonArea(corners);
  const sourceArea = polygonArea(points);
  const coveragePenalty =
    Math.abs(sourceArea / Math.max(targetArea, 1) - 1) * 0.1;
  const aspectPenalty = asSquare
    ? Math.abs(halfWidth - halfHeight) / bounds.diagonal * 0.6
    : 0;
  const score = edgeError + aspectPenalty + coveragePenalty;

  if (score > SHAPE_MAX_SCORE) {
    return null;
  }

  return {
    kind: asSquare ? 'square' : 'rectangle',
    family: 'rectangle',
    score,
    geometry: {
      type: 'polygon',
      points: corners,
    },
  };
}

function polygonKindForSides(sides: number): ShapeKind | null {
  switch (sides) {
    case 3:
      return 'triangle';
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

function fitPolygon(
  points: PointLike[],
  bounds: Bounds,
  simplifiedHull: PointLike[],
): Candidate | null {
  const kind = polygonKindForSides(simplifiedHull.length);
  if (!kind) {
    return null;
  }

  const edgeLengths = simplifiedHull.map((point, index) =>
    distance(point, simplifiedHull[(index + 1) % simplifiedHull.length]),
  );
  const meanEdgeLength =
    edgeLengths.reduce((sum, value) => sum + value, 0) /
    Math.max(edgeLengths.length, 1);
  const edgeVariance = Math.sqrt(
    edgeLengths.reduce(
      (sum, value) => sum + square(value - meanEdgeLength),
      0,
    ) / Math.max(edgeLengths.length, 1),
  ) / Math.max(meanEdgeLength, 1);

  const turnAngles = simplifiedHull.map((point, index) => {
    const previous = simplifiedHull[
      (index - 1 + simplifiedHull.length) % simplifiedHull.length
    ];
    const next = simplifiedHull[(index + 1) % simplifiedHull.length];
    const leftVector = {x: point.x - previous.x, y: point.y - previous.y};
    const rightVector = {x: next.x - point.x, y: next.y - point.y};
    const leftLength = Math.hypot(leftVector.x, leftVector.y);
    const rightLength = Math.hypot(rightVector.x, rightVector.y);
    const normalizedDot =
      (leftVector.x * rightVector.x + leftVector.y * rightVector.y) /
      Math.max(leftLength * rightLength, 1);

    return Math.acos(clamp(normalizedDot, -1, 1));
  });
  const meanTurnAngle =
    turnAngles.reduce((sum, value) => sum + value, 0) /
    Math.max(turnAngles.length, 1);
  const turnAngleVariance = Math.sqrt(
    turnAngles.reduce(
      (sum, value) => sum + square(value - meanTurnAngle),
      0,
    ) / Math.max(turnAngles.length, 1),
  );

  const score =
    averageDistanceToSegments(points, buildPolygonSegments(simplifiedHull)) /
      bounds.diagonal +
    edgeVariance * 0.2 +
    turnAngleVariance * 0.05;

  if (score > SHAPE_MAX_SCORE) {
    return null;
  }

  return {
    kind,
    family: 'polygon',
    score,
    geometry: {
      type: 'polygon',
      points: simplifiedHull,
    },
  };
}

function containsTextSignal(recognitionNames: string[]): boolean {
  return recognitionNames.some(name =>
    /(text|letter|word|char|digit|number|handwriting|symbol)/i.test(name),
  );
}

function pathLength(points: PointLike[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function longestPath(paths: PointLike[][]): PointLike[] {
  if (!paths.length) {
    return [];
  }

  return paths.reduce((best, path) =>
    pathLength(path) > pathLength(best) ? path : best,
  );
}

function chooseBestCandidate(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) {
    return null;
  }

  const circle = candidates.find(candidate => candidate.kind === 'circle');
  const ellipse = candidates.find(candidate => candidate.kind === 'ellipse');
  const square = candidates.find(candidate => candidate.kind === 'square');
  const rectangle = candidates.find(candidate => candidate.kind === 'rectangle');

  let best = candidates.reduce((winner, candidate) =>
    candidate.score < winner.score ? candidate : winner,
  );

  if (
    circle &&
    ellipse &&
    circle.score <= ellipse.score + CIRCLE_PREFERENCE_MARGIN
  ) {
    best = best.kind === 'ellipse' ? circle : best;
  }

  if (
    square &&
    rectangle &&
    square.score <= rectangle.score + SQUARE_PREFERENCE_MARGIN
  ) {
    best = best.kind === 'rectangle' ? square : best;
  }

  return best;
}

export function detectBestShape(
  input: ShapeDetectionInput,
): ShapeMatch | null {
  const samplePoints = dedupeSequential(input.samplePoints);
  const strokePaths = input.strokePaths
    .map(path => dedupeSequential(path))
    .filter(path => path.length >= 2);

  if (samplePoints.length < MIN_COMPONENT_POINTS) {
    return null;
  }

  const bounds = buildBounds(samplePoints);
  if (
    Math.max(bounds.width, bounds.height) < MIN_COMPONENT_SIZE ||
    Math.min(bounds.width, bounds.height) < 4
  ) {
    return null;
  }

  const recognitionNames = (input.recognitionNames ?? [])
    .map(name => name.trim())
    .filter(Boolean);

  const hull = convexHull(samplePoints);
  if (hull.length < 2) {
    return null;
  }

  const hullArea = polygonArea(hull);
  const fillRatio = hullArea / Math.max(bounds.area, 1);
  const primaryPath = longestPath(strokePaths);
  const primaryPathBounds =
    primaryPath.length >= 2 ? buildBounds(primaryPath) : bounds;
  const closureGap =
    primaryPath.length >= 2
      ? distance(primaryPath[0], primaryPath[primaryPath.length - 1]) /
        Math.max(primaryPathBounds.diagonal, 1)
      : 0;
  const canBeClosedShape =
    strokePaths.length > 1 || closureGap <= 0.18 || fillRatio >= 0.22;

  const simplifiedHull = simplifyClosedPolygon(
    hull,
    Math.max(bounds.diagonal * HULL_SIMPLIFY_FACTOR, 6),
    bounds.diagonal,
  );
  const simplifiedPrimaryPath =
    primaryPath.length >= 2
      ? simplifyDouglasPeucker(
          primaryPath,
          Math.max(bounds.diagonal * PATH_SIMPLIFY_FACTOR, 4),
        )
      : [];
  const simplifiedClosedPath =
    canBeClosedShape && primaryPath.length >= 3
      ? simplifyClosedPolygon(
          primaryPath,
          Math.max(bounds.diagonal * 0.03, 5),
          bounds.diagonal,
        )
      : [];
  const polygonContour =
    simplifiedClosedPath.length >= 3 && simplifiedClosedPath.length <= 8
      ? simplifiedClosedPath
      : strokePaths.length > 1 &&
          simplifiedHull.length >= 3 &&
          simplifiedHull.length <= 8
        ? simplifiedHull
        : [];
  const orthogonalContour =
    polygonContour.length >= 4 && polygonContour.length <= 5
      ? polygonContour
      : hull;

  const lineCandidate = fitLine(samplePoints, bounds);
  const circleCandidate =
    canBeClosedShape && fillRatio >= MIN_FILL_RATIO ? fitCircle(hull, bounds) : null;
  const ellipseCandidate =
    canBeClosedShape && fillRatio >= MIN_FILL_RATIO
      ? fitEllipse(hull, bounds)
      : null;
  const rectangleCandidate =
    canBeClosedShape && fillRatio >= MIN_FILL_RATIO
      ? fitRectangle(orthogonalContour, bounds, false)
      : null;
  const squareCandidate =
    canBeClosedShape && fillRatio >= MIN_FILL_RATIO
      ? fitRectangle(orthogonalContour, bounds, true)
      : null;
  const polygonCandidate =
    canBeClosedShape &&
    fillRatio >= MIN_FILL_RATIO &&
    polygonContour.length >= 3
      ? fitPolygon(hull, bounds, polygonContour)
      : null;

  const lineLike = Boolean(lineCandidate);
  const complexOpenShape =
    !canBeClosedShape &&
    simplifiedPrimaryPath.length > 6 &&
    !lineLike;

  if (containsTextSignal(recognitionNames)) {
    return null;
  }

  if (!lineLike && fillRatio < MIN_FILL_RATIO && !canBeClosedShape) {
    return null;
  }

  if (complexOpenShape) {
    return null;
  }

  if (
    !lineLike &&
    polygonContour.length > 8 &&
    !(circleCandidate || ellipseCandidate)
  ) {
    return null;
  }

  const candidates = [
    lineCandidate,
    circleCandidate,
    ellipseCandidate,
    rectangleCandidate,
    squareCandidate,
    polygonCandidate,
  ].filter(Boolean) as Candidate[];

  if (!candidates.length) {
    return null;
  }

  const best = chooseBestCandidate(candidates);
  if (!best) {
    return null;
  }

  let selected = best;
  const polygonSideCount = polygonContour.length;
  const quadrilateralCandidate = chooseBestCandidate(
    [squareCandidate, rectangleCandidate].filter(Boolean) as Candidate[],
  );
  const roundCandidate = chooseBestCandidate(
    [circleCandidate, ellipseCandidate].filter(Boolean) as Candidate[],
  );

  if (
    polygonCandidate &&
    [3, 5, 6, 7, 8].includes(polygonSideCount) &&
    (!selected || polygonCandidate.score <= selected.score + 0.03)
  ) {
    selected = polygonCandidate;
  } else if (
    quadrilateralCandidate &&
    polygonSideCount >= 4 &&
    polygonSideCount <= 5 &&
    (!roundCandidate || quadrilateralCandidate.score <= roundCandidate.score + 0.07)
  ) {
    selected = quadrilateralCandidate;
  }

  if (
    selected.score >
    (selected.kind === 'line' ? LINE_MAX_SCORE : SHAPE_MAX_SCORE)
  ) {
    return null;
  }

  return {
    kind: selected.kind,
    score: selected.score,
    geometry: selected.geometry,
    diagnostics: {
      closureGap,
      fillRatio,
      simplifiedVertexCount: polygonContour.length,
    },
  };
}
