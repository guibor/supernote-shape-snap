import fs from 'node:fs';
import path from 'node:path';
import {detectBestShape, type PointLike} from '../src/shapeMatching';

type SampleFixture = {
  elements: Array<{
    index: number;
    recognition_name: string | null;
    sample_points_px: PointLike[];
    contour_groups_px: PointLike[][];
  }>;
};

function loadSamplePageFixture(): SampleFixture {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'sample-page-2026-04-09.json',
  );
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as SampleFixture;
}

function jitter(value: number, seed: number, amount = 2): number {
  return value + Math.sin(seed * 1.37) * amount;
}

function sampleCircle(
  center: PointLike,
  radius: number,
  count = 48,
): PointLike[] {
  return Array.from({length: count}, (_, index) => {
    const theta = (Math.PI * 2 * index) / count;
    return {
      x: jitter(center.x + Math.cos(theta) * radius, index),
      y: jitter(center.y + Math.sin(theta) * radius, index + 100),
    };
  });
}

function sampleEllipse(
  center: PointLike,
  major: number,
  minor: number,
  count = 56,
): PointLike[] {
  return Array.from({length: count}, (_, index) => {
    const theta = (Math.PI * 2 * index) / count;
    return {
      x: jitter(center.x + Math.cos(theta) * major, index, 1.5),
      y: jitter(center.y + Math.sin(theta) * minor, index + 200, 1.5),
    };
  });
}

function sampleRotatedEllipse(
  center: PointLike,
  major: number,
  minor: number,
  angle: number,
  count = 56,
): PointLike[] {
  return Array.from({length: count}, (_, index) => {
    const theta = (Math.PI * 2 * index) / count;
    const localX = Math.cos(theta) * major;
    const localY = Math.sin(theta) * minor;
    return {
      x: jitter(
        center.x + localX * Math.cos(angle) - localY * Math.sin(angle),
        index,
        1.5,
      ),
      y: jitter(
        center.y + localX * Math.sin(angle) + localY * Math.cos(angle),
        index + 200,
        1.5,
      ),
    };
  });
}

function samplePolygon(vertices: PointLike[], pointsPerEdge = 12): PointLike[] {
  const points: PointLike[] = [];

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];

    for (let step = 0; step < pointsPerEdge; step += 1) {
      const ratio = step / pointsPerEdge;
      points.push({
        x: jitter(start.x + (end.x - start.x) * ratio, index * 100 + step, 1.2),
        y: jitter(start.y + (end.y - start.y) * ratio, index * 200 + step, 1.2),
      });
    }
  }

  return points;
}

function sampleLine(start: PointLike, end: PointLike, count = 24): PointLike[] {
  return Array.from({length: count}, (_, index) => {
    const ratio = index / (count - 1);
    return {
      x: jitter(start.x + (end.x - start.x) * ratio, index, 0.6),
      y: jitter(start.y + (end.y - start.y) * ratio, index + 90, 0.6),
    };
  });
}

function withClosingTail(points: PointLike[], tailLength = 18): PointLike[] {
  if (points.length < 8) {
    return points.slice();
  }

  const start = points[0];
  const tailStart = points[points.length - 1];
  const overshoot = {
    x: start.x + (start.x - tailStart.x) * 0.12,
    y: start.y + (start.y - tailStart.y) * 0.12,
  };

  return points.concat([
    midpoint(tailStart, overshoot),
    overshoot,
    midpoint(overshoot, start),
    start,
  ]);
}

function midpoint(left: PointLike, right: PointLike): PointLike {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function rotatePoints(
  points: PointLike[],
  center: PointLike,
  angle: number,
): PointLike[] {
  return points.map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  });
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

describe('detectBestShape', () => {
  it('prefers a circle over a near-circle ellipse', () => {
    const points = sampleCircle({x: 200, y: 200}, 80);
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('circle');
  });

  it('keeps a clearly oval shape as an ellipse', () => {
    const points = sampleEllipse({x: 220, y: 180}, 120, 70);
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('ellipse');
  });

  it('prefers a square over a barely rectangular quadrilateral', () => {
    const squareish = samplePolygon([
      {x: 120, y: 120},
      {x: 240, y: 126},
      {x: 236, y: 244},
      {x: 116, y: 238},
    ]);
    const result = detectBestShape({
      samplePoints: squareish,
      strokePaths: [squareish],
    });

    expect(result?.kind).toBe('square');
  });

  it('detects a clearly rectangular quadrilateral as a rectangle', () => {
    const rectangle = samplePolygon([
      {x: 120, y: 120},
      {x: 300, y: 134},
      {x: 292, y: 228},
      {x: 114, y: 216},
    ]);
    const result = detectBestShape({
      samplePoints: rectangle,
      strokePaths: [rectangle],
    });

    expect(result?.kind).toBe('rectangle');
  });

  it('detects a rough triangle from an imperfect closed contour', () => {
    const triangle = samplePolygon([
      {x: 180, y: 90},
      {x: 290, y: 260},
      {x: 95, y: 245},
    ]);
    const result = detectBestShape({
      samplePoints: triangle,
      strokePaths: [triangle],
    });

    expect(result?.kind).toBe('triangle');
  });

  it('detects a pentagon from a five-sided contour', () => {
    const pentagon = samplePolygon([
      {x: 200, y: 80},
      {x: 300, y: 150},
      {x: 260, y: 270},
      {x: 140, y: 270},
      {x: 100, y: 150},
    ]);
    const result = detectBestShape({
      samplePoints: pentagon,
      strokePaths: [pentagon],
    });

    expect(result?.kind).toBe('pentagon');
  });

  it('handles a square with a small closing overshoot', () => {
    const square = samplePolygon([
      {x: 120, y: 120},
      {x: 238, y: 124},
      {x: 234, y: 244},
      {x: 118, y: 240},
    ]);
    const tailed = withClosingTail(square);
    const result = detectBestShape({
      samplePoints: tailed,
      strokePaths: [tailed],
    });

    expect(result?.kind).toBe('square');
  });

  it('detects a very straight open stroke as a line', () => {
    const points = sampleLine({x: 80, y: 90}, {x: 320, y: 95});
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('line');
  });

  it('snaps a near-horizontal line to exact horizontal orientation', () => {
    const points = sampleLine({x: 80, y: 90}, {x: 320, y: 120});
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('line');
    expect(result?.geometry.type).toBe('line');
    if (result?.geometry.type !== 'line') {
      throw new Error('Expected line geometry');
    }

    expect(Math.abs(result.geometry.points[0].y - result.geometry.points[1].y)).toBeLessThan(0.0001);
  });

  it('snaps a near-vertical line to exact vertical orientation when horizontal does not apply', () => {
    const points = sampleLine({x: 80, y: 90}, {x: 110, y: 330});
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('line');
    expect(result?.geometry.type).toBe('line');
    if (result?.geometry.type !== 'line') {
      throw new Error('Expected line geometry');
    }

    expect(Math.abs(result.geometry.points[0].x - result.geometry.points[1].x)).toBeLessThan(0.0001);
  });

  it('snaps a near-horizontal ellipse axis to horizontal', () => {
    const points = sampleRotatedEllipse(
      {x: 220, y: 180},
      120,
      70,
      (7 * Math.PI) / 180,
    );
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('ellipse');
    expect(result?.geometry.type).toBe('ellipse');
    if (result?.geometry.type !== 'ellipse') {
      throw new Error('Expected ellipse geometry');
    }

    expect(normalizeAxisAngle(result.geometry.angle)).toBeLessThan(0.0001);
  });

  it('snaps a near-horizontal rectangle edge to horizontal', () => {
    const center = {x: 210, y: 180};
    const rotatedVertices = rotatePoints(
      [
        {x: 120, y: 120},
        {x: 300, y: 120},
        {x: 300, y: 240},
        {x: 120, y: 240},
      ],
      center,
      (8 * Math.PI) / 180,
    );
    const points = samplePolygon(rotatedVertices);
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('rectangle');
    expect(result?.geometry.type).toBe('polygon');
    if (result?.geometry.type !== 'polygon') {
      throw new Error('Expected polygon geometry');
    }

    const geometry = result.geometry;
    const edgeAngles = geometry.points.map((point, index) => {
      const next = geometry.points[(index + 1) % geometry.points.length];
      return Math.atan2(next.y - point.y, next.x - point.x);
    });
    const minHorizontalDelta = Math.min(
      ...edgeAngles.map(angle => Math.abs(shortestAxisDelta(angle, 0))),
    );

    expect(minHorizontalDelta).toBeLessThan(0.0001);
  });

  it('suppresses text-like handwriting hints', () => {
    const scribble = [
      {x: 100, y: 100},
      {x: 118, y: 88},
      {x: 132, y: 126},
      {x: 148, y: 92},
      {x: 164, y: 118},
      {x: 176, y: 94},
      {x: 188, y: 126},
      {x: 204, y: 100},
    ];
    const result = detectBestShape({
      samplePoints: scribble,
      strokePaths: [scribble],
      recognitionNames: ['text'],
    });

    expect(result).toBeNull();
  });

  it('rejects a dense scribble without recognition hints', () => {
    const scribble = [
      {x: 100, y: 100},
      {x: 132, y: 78},
      {x: 144, y: 132},
      {x: 164, y: 84},
      {x: 182, y: 140},
      {x: 205, y: 90},
      {x: 224, y: 145},
      {x: 242, y: 88},
      {x: 214, y: 164},
      {x: 188, y: 106},
      {x: 165, y: 168},
      {x: 138, y: 104},
      {x: 116, y: 158},
      {x: 102, y: 102},
    ];
    const result = detectBestShape({
      samplePoints: scribble,
      strokePaths: [scribble],
    });

    expect(result).toBeNull();
  });

  it('matches the exported sample benchmark page as expected', () => {
    const fixture = loadSamplePageFixture();
    const expectedKinds = [
      'rectangle',
      'rectangle',
      'circle',
      'ellipse',
      'ellipse',
      'triangle',
      'ellipse',
      'pentagon',
      'ellipse',
      'rectangle',
    ] as const;

    const actualKinds = fixture.elements.map(element => {
      const contourPoints = element.contour_groups_px.flat();
      const samplePoints =
        contourPoints.length >= 8 ? contourPoints : element.sample_points_px;
      return (
        detectBestShape({
          samplePoints,
          strokePaths: [element.sample_points_px],
          recognitionNames: element.recognition_name
            ? [element.recognition_name]
            : [],
        })?.kind ?? null
      );
    });

    expect(actualKinds).toEqual(expectedKinds);
  });
});
