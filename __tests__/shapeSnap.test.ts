jest.mock('sn-plugin-lib', () => ({
  Element: {
    TYPE_GEO: 'geo',
    TYPE_STROKE: 'stroke',
  },
  Geometry: class Geometry {
    static TYPE_STRAIGHT_LINE = 'straightLine';
    static TYPE_CIRCLE = 'GEO_circle';
    static TYPE_ELLIPSE = 'GEO_ellipse';
    static TYPE_POLYGON = 'GEO_polygon';
    penColor = 0;
    penType = 0;
    penWidth = 0;
    type = '';
    points = [];
    ellipseCenterPoint = null;
    ellipseMajorAxisRadius = 0;
    ellipseMinorAxisRadius = 0;
    ellipseAngle = 0;
  },
  NativeUIUtils: {},
  PluginCommAPI: {},
  PluginFileAPI: {},
  PluginNoteAPI: {},
  PointUtils: {
    emrPoint2Android: (point: {x: number; y: number}) => point,
  },
}));

import {closePolygonPoints} from '../src/shapeSnap';

describe('closePolygonPoints', () => {
  it('repeats the first polygon vertex at the end when needed', () => {
    const closed = closePolygonPoints([
      {x: 10, y: 10},
      {x: 40, y: 10},
      {x: 40, y: 30},
      {x: 10, y: 30},
    ]);

    expect(closed).toEqual([
      {x: 10, y: 10},
      {x: 40, y: 10},
      {x: 40, y: 30},
      {x: 10, y: 30},
      {x: 10, y: 10},
    ]);
  });

  it('does not duplicate the closing point if the polygon is already closed', () => {
    const closed = closePolygonPoints([
      {x: 10, y: 10},
      {x: 40, y: 10},
      {x: 40, y: 30},
      {x: 10, y: 30},
      {x: 10, y: 10},
    ]);

    expect(closed).toHaveLength(5);
    expect(closed[0]).toEqual(closed[closed.length - 1]);
  });
});
