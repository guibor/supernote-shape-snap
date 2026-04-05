import {detectBestShape, type PointLike} from '../src/shapeMatching';

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

  it('detects a very straight open stroke as a line', () => {
    const points = sampleLine({x: 80, y: 90}, {x: 320, y: 95});
    const result = detectBestShape({samplePoints: points, strokePaths: [points]});

    expect(result?.kind).toBe('line');
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
});
