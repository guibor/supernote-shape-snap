import {
  Element,
  Geometry,
  NativeUIUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  PointUtils,
  type Point,
} from 'sn-plugin-lib';
import {
  detectBestShape,
  type GeometryDescriptor,
  type PointLike,
} from './shapeMatching';

export const SNAP_SHAPE_BUTTON_ID = 4200;

type APIErrorShape = {
  code?: number;
  message?: string;
};

type APIResponse<T> = {
  success: boolean;
  result?: T;
  error?: APIErrorShape;
};

type Size = {
  width: number;
  height: number;
};

type LayerInfo = {
  layerId: number;
  isCurrentLayer: boolean;
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  diagonal: number;
  center: PointLike;
};

type StrokeInfo = {
  element: Element;
  pageIndex: number;
  layerNum: number;
  bounds: Bounds;
  strokePath: PointLike[];
  samplePoints: PointLike[];
  recognitionName: string | null;
  penColor: number;
  penType: number;
  thickness: number;
};

type StrokeCluster = {
  strokes: StrokeInfo[];
  insertionIndex: number;
  layerNum: number;
};

type GeometryStyle = {
  penColor: number;
  penType: number;
  penWidth: number;
};

type ClusterReplacement = {
  insertionIndex: number;
  replacedUuids: Set<string>;
  geometryElement: Element;
};

type ClusterMatch = {
  cluster: StrokeCluster;
  geometryDescriptor: GeometryDescriptor;
};

type FastPathPlan = {
  geometries: Geometry[];
};

let isSnapping = false;

function asResponse<T>(value: unknown): APIResponse<T> {
  return value as APIResponse<T>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

async function showStatus(message: string, isSuccess: boolean): Promise<void> {
  try {
    await NativeUIUtils.showRattaDialog(message, 'OK', '', isSuccess);
  } catch (error) {
    console.warn('Failed to show Snap Shape dialog', describeError(error));
  }
}

function throwIfFailed<T>(response: APIResponse<T>, context: string): T {
  if (!response?.success) {
    throw new Error(response?.error?.message ?? context);
  }

  return response.result as T;
}

function distance(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
    center: {
      x: left + width / 2,
      y: top + height / 2,
    },
  };
}

function boundsGap(left: Bounds, right: Bounds): number {
  const horizontal =
    Math.max(0, left.left - right.right) + Math.max(0, right.left - left.right);
  const vertical =
    Math.max(0, left.top - right.bottom) + Math.max(0, right.top - left.bottom);

  return Math.hypot(horizontal, vertical);
}

function dominantValue(values: number[], fallback: number): number {
  if (!values.length) {
    return fallback;
  }

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let bestValue = fallback;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
}

function median(values: number[], fallback: number): number {
  if (!values.length) {
    return fallback;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizePoint(point: PointLike): PointLike {
  return {
    x: Math.round(point.x * 1000) / 1000,
    y: Math.round(point.y * 1000) / 1000,
  };
}

async function readAllAccessorItems<T>(
  accessor: {
    size(): Promise<number>;
    getRange(startIndex: number, count: number): Promise<T[]>;
  } | null | undefined,
): Promise<T[]> {
  if (!accessor) {
    return [];
  }

  const size = await accessor.size();
  if (!size) {
    return [];
  }

  return accessor.getRange(0, size);
}

async function readStrokePath(
  element: Element,
  pageSize: Size,
): Promise<PointLike[]> {
  const strokePoints = await readAllAccessorItems<Point>(element.stroke?.points);
  return strokePoints.map(point =>
    normalizePoint(PointUtils.emrPoint2Android(point, pageSize)),
  );
}

async function readSamplePoints(
  element: Element,
  pageSize: Size,
): Promise<PointLike[]> {
  const contours = await readAllAccessorItems<Point[]>(element.contoursSrc);
  const contourPoints = contours.flat().map(normalizePoint);

  if (contourPoints.length >= 8) {
    return contourPoints;
  }

  return readStrokePath(element, pageSize);
}

function minEndpointDistance(left: StrokeInfo, right: StrokeInfo): number {
  const leftEndpoints = [
    left.strokePath[0],
    left.strokePath[left.strokePath.length - 1],
  ].filter(Boolean) as PointLike[];
  const rightEndpoints = [
    right.strokePath[0],
    right.strokePath[right.strokePath.length - 1],
  ].filter(Boolean) as PointLike[];

  let best = Number.POSITIVE_INFINITY;

  for (const start of leftEndpoints) {
    for (const end of rightEndpoints) {
      best = Math.min(best, distance(start, end));
    }
  }

  return best;
}

function shouldClusterTogether(left: StrokeInfo, right: StrokeInfo): boolean {
  if (left.layerNum !== right.layerNum) {
    return false;
  }

  const gap = boundsGap(left.bounds, right.bounds);
  const endpointGap = minEndpointDistance(left, right);
  const diagonal = Math.min(left.bounds.diagonal, right.bounds.diagonal);
  const closeByBounds = gap <= Math.max(18, diagonal * 0.08);
  const closeByEndpoints = endpointGap <= Math.max(28, diagonal * 0.22);
  const overlappingWithPadding =
    gap <= Math.max(24, diagonal * 0.14) &&
    endpointGap <= Math.max(42, diagonal * 0.3);

  return (closeByBounds && closeByEndpoints) || overlappingWithPadding;
}

function clusterStrokes(strokes: StrokeInfo[]): StrokeCluster[] {
  const remaining = new Set(strokes.map((_, index) => index));
  const clusters: StrokeCluster[] = [];

  while (remaining.size) {
    const seed = remaining.values().next().value as number;
    remaining.delete(seed);

    const queue = [seed];
    const clusterIndices = [seed];

    while (queue.length) {
      const current = queue.shift() as number;
      const currentStroke = strokes[current];

      for (const candidate of Array.from(remaining)) {
        if (!shouldClusterTogether(currentStroke, strokes[candidate])) {
          continue;
        }

        remaining.delete(candidate);
        queue.push(candidate);
        clusterIndices.push(candidate);
      }
    }

    const clusterStrokesList = clusterIndices
      .map(index => strokes[index])
      .sort((left, right) => left.pageIndex - right.pageIndex);

    clusters.push({
      strokes: clusterStrokesList,
      insertionIndex: clusterStrokesList[0]?.pageIndex ?? 0,
      layerNum: clusterStrokesList[0]?.layerNum ?? 0,
    });
  }

  return clusters.sort((left, right) => left.insertionIndex - right.insertionIndex);
}

function deriveClusterStyle(cluster: StrokeCluster): GeometryStyle {
  const colors = cluster.strokes.map(stroke => stroke.penColor);
  const penTypes = cluster.strokes.map(stroke => stroke.penType);
  const widths = cluster.strokes.map(stroke => stroke.thickness);

  return {
    penColor: dominantValue(colors, 0x9d),
    penType: dominantValue(penTypes, 10),
    penWidth: Math.max(1, Math.round(median(widths, 2))),
  };
}

function buildGeometry(
  geometryDescriptor: GeometryDescriptor,
  style: GeometryStyle,
): Geometry {
  const geometry = new Geometry();

  geometry.penColor = style.penColor;
  geometry.penType = style.penType;
  geometry.penWidth = style.penWidth;

  if (geometryDescriptor.type === 'line') {
    geometry.type = Geometry.TYPE_STRAIGHT_LINE;
    geometry.points = geometryDescriptor.points;
    geometry.ellipseCenterPoint = null;
    geometry.ellipseMajorAxisRadius = 0;
    geometry.ellipseMinorAxisRadius = 0;
    geometry.ellipseAngle = 0;
    return geometry;
  }

  if (geometryDescriptor.type === 'ellipse') {
    const isCircle =
      Math.abs(geometryDescriptor.majorRadius - geometryDescriptor.minorRadius) <= 1;

    geometry.type = isCircle ? Geometry.TYPE_CIRCLE : Geometry.TYPE_ELLIPSE;
    geometry.points = [];
    geometry.ellipseCenterPoint = geometryDescriptor.center;
    geometry.ellipseMajorAxisRadius = geometryDescriptor.majorRadius;
    geometry.ellipseMinorAxisRadius = geometryDescriptor.minorRadius;
    geometry.ellipseAngle = geometryDescriptor.angle;
    return geometry;
  }

  geometry.type = Geometry.TYPE_POLYGON;
  geometry.points = geometryDescriptor.points;
  geometry.ellipseCenterPoint = null;
  geometry.ellipseMajorAxisRadius = 0;
  geometry.ellipseMinorAxisRadius = 0;
  geometry.ellipseAngle = 0;

  return geometry;
}

function matchClusters(clusters: StrokeCluster[]): ClusterMatch[] {
  const matches: ClusterMatch[] = [];

  for (const cluster of clusters) {
    const match = detectBestShape({
      samplePoints: cluster.strokes.flatMap(stroke => stroke.samplePoints),
      strokePaths: cluster.strokes.map(stroke => stroke.strokePath),
      recognitionNames: cluster.strokes
        .map(stroke => stroke.recognitionName)
        .filter(Boolean) as string[],
    });

    if (!match) {
      continue;
    }

    matches.push({
      cluster,
      geometryDescriptor: match.geometry,
    });
  }

  return matches;
}

async function createGeometryElement(
  geometryDescriptor: GeometryDescriptor,
  style: GeometryStyle,
  page: number,
  layer: number,
): Promise<Element> {
  const createResponse = asResponse<Element>(
    await PluginCommAPI.createElement(Element.TYPE_GEO),
  );
  const element = throwIfFailed(createResponse, 'Failed to create geometry element');
  const geometry = buildGeometry(geometryDescriptor, style);

  element.pageNum = page;
  element.layerNum = layer;
  element.thickness = style.penWidth;
  element.geometry = geometry;

  return element;
}

function buildFinalPageElements(
  pageElements: Element[],
  replacements: ClusterReplacement[],
): Element[] {
  const insertions = new Map<number, Element[]>();
  const removedUuids = new Set<string>();

  for (const replacement of replacements) {
    for (const uuid of replacement.replacedUuids) {
      removedUuids.add(uuid);
    }

    const existing = insertions.get(replacement.insertionIndex) ?? [];
    existing.push(replacement.geometryElement);
    insertions.set(replacement.insertionIndex, existing);
  }

  const finalElements: Element[] = [];

  for (let index = 0; index < pageElements.length; index += 1) {
    const pending = insertions.get(index);
    if (pending?.length) {
      finalElements.push(...pending);
      insertions.delete(index);
    }

    const element = pageElements[index];
    if (removedUuids.has(element.uuid)) {
      continue;
    }

    finalElements.push(element);
  }

  const trailing = insertions.get(pageElements.length);
  if (trailing?.length) {
    finalElements.push(...trailing);
  }

  return finalElements;
}

async function buildStrokeInfo(
  element: Element,
  pageIndex: number,
  pageSize: Size,
): Promise<StrokeInfo | null> {
  if (element.type !== Element.TYPE_STROKE || !element.stroke) {
    return null;
  }

  const strokePath = await readStrokePath(element, pageSize);
  const samplePoints = await readSamplePoints(element, pageSize);

  if (strokePath.length < 2 || samplePoints.length < 6) {
    return null;
  }

  return {
    element,
    pageIndex,
    layerNum: element.layerNum ?? 0,
    bounds: buildBounds(samplePoints),
    strokePath,
    samplePoints,
    recognitionName: element.recognizeResult?.predict_name?.trim() || null,
    penColor: element.stroke.penColor ?? 0x9d,
    penType: element.stroke.penType ?? 10,
    thickness: Math.max(1, Math.round(element.thickness || 2)),
  };
}

function isNotePath(filePath: string): boolean {
  return /\.note$/i.test(filePath);
}

async function getCurrentLayerId(
  filePath: string,
  page: number,
): Promise<number | null> {
  if (!isNotePath(filePath)) {
    return null;
  }

  const layers = throwIfFailed(
    asResponse<LayerInfo[]>(await PluginFileAPI.getLayers(filePath, page)),
    'Failed to get note layers',
  );

  const currentLayer = layers.find(layer => layer.isCurrentLayer);
  return currentLayer?.layerId ?? 0;
}

async function buildFastPathPlan(
  filePath: string,
  page: number,
  lassoElements: Element[],
  pageSize: Size,
): Promise<FastPathPlan | null> {
  const selectedStrokes = lassoElements.filter(
    element => element.type === Element.TYPE_STROKE,
  );

  if (!selectedStrokes.length || selectedStrokes.length !== lassoElements.length) {
    return null;
  }

  const strokeInfos = (
    await Promise.all(
      selectedStrokes.map((element, index) => buildStrokeInfo(element, index, pageSize)),
    )
  ).filter(Boolean) as StrokeInfo[];

  if (strokeInfos.length !== selectedStrokes.length) {
    return null;
  }

  const clusters = clusterStrokes(strokeInfos);
  const matches = matchClusters(clusters);

  if (matches.length !== clusters.length) {
    return null;
  }

  const currentLayerId = await getCurrentLayerId(filePath, page);
  if (
    currentLayerId !== null &&
    matches.some(match => match.cluster.layerNum !== currentLayerId)
  ) {
    return null;
  }

  return {
    geometries: matches.map(({cluster, geometryDescriptor}) =>
      buildGeometry(geometryDescriptor, deriveClusterStyle(cluster)),
    ),
  };
}

async function executeFastPath(plan: FastPathPlan): Promise<void> {
  const deleteResponse = asResponse<boolean>(await PluginCommAPI.deleteLassoElements());
  throwIfFailed(deleteResponse, 'Failed to delete selected strokes');

  for (const geometry of plan.geometries) {
    const insertResponse = asResponse<boolean>(
      await PluginCommAPI.insertGeometry(geometry),
    );
    throwIfFailed(insertResponse, 'Failed to insert snapped geometry');
  }

  const clearLassoResponse = asResponse<boolean>(
    await PluginCommAPI.setLassoBoxState(2),
  );
  if (!clearLassoResponse?.success) {
    console.warn('Failed to clear lasso box after fast-path snapping');
  }
}

async function executeFallbackPageReplace(
  filePath: string,
  page: number,
  lassoElements: Element[],
  pageSize: Size,
): Promise<boolean> {
  if (isNotePath(filePath)) {
    const saveResponse = asResponse<boolean>(await PluginNoteAPI.saveCurrentNote());
    if (!saveResponse?.success) {
      console.warn('saveCurrentNote failed; continuing with file-level read/write');
    }
  }

  const pageElements = throwIfFailed(
    asResponse<Element[]>(await PluginFileAPI.getElements(page, filePath)),
    'Failed to get page elements',
  );

  const selectedStrokeUuids = new Set(
    lassoElements
      .filter(element => element.type === Element.TYPE_STROKE)
      .map(element => element.uuid),
  );
  const selectedStrokeNums = new Set(
    lassoElements
      .filter(element => element.type === Element.TYPE_STROKE)
      .map(element => element.numInPage),
  );

  const matchingPageStrokes = pageElements
    .map((element, index) => ({element, index}))
    .filter(
      ({element}) =>
        element.type === Element.TYPE_STROKE &&
        (selectedStrokeUuids.has(element.uuid) ||
          selectedStrokeNums.has(element.numInPage)),
    );

  if (!matchingPageStrokes.length) {
    await showStatus('Snap Shape: no matching stroke elements found on the page.', false);
    return true;
  }

  const strokeInfos = (
    await Promise.all(
      matchingPageStrokes.map(({element, index}) =>
        buildStrokeInfo(element, index, pageSize),
      ),
    )
  ).filter(Boolean) as StrokeInfo[];

  if (!strokeInfos.length) {
    await showStatus('Snap Shape: no usable stroke data found in the selection.', false);
    return true;
  }

  const clusters = clusterStrokes(strokeInfos);
  const matches = matchClusters(clusters);

  if (!matches.length) {
    await showStatus(
      'Snap Shape could not find a clear shape match for this selection.',
      false,
    );
    return true;
  }

  const replacements: ClusterReplacement[] = [];

  for (const {cluster, geometryDescriptor} of matches) {
    const geometryElement = await createGeometryElement(
      geometryDescriptor,
      deriveClusterStyle(cluster),
      page,
      cluster.layerNum,
    );

    replacements.push({
      insertionIndex: cluster.insertionIndex,
      replacedUuids: new Set(cluster.strokes.map(stroke => stroke.element.uuid)),
      geometryElement,
    });
  }

  const finalElements = buildFinalPageElements(pageElements, replacements);
  const replaceResponse = asResponse<boolean>(
    await PluginFileAPI.replaceElements(filePath, page, finalElements),
  );
  throwIfFailed(replaceResponse, 'Failed to replace page elements');

  const clearLassoResponse = asResponse<boolean>(await PluginCommAPI.setLassoBoxState(2));
  if (!clearLassoResponse?.success) {
    console.warn('Failed to clear lasso box after snapping');
  }

  const reloadResponse = asResponse<boolean>(await PluginCommAPI.reloadFile());
  if (!reloadResponse?.success) {
    console.warn('reloadFile failed after shape snap');
  }

  return true;
}

export async function snapCurrentSelection(): Promise<void> {
  if (isSnapping) {
    return;
  }

  isSnapping = true;

  try {
    const filePath = throwIfFailed(
      asResponse<string>(await PluginCommAPI.getCurrentFilePath()),
      'Failed to get current file path',
    );
    const page = throwIfFailed(
      asResponse<number>(await PluginCommAPI.getCurrentPageNum()),
      'Failed to get current page number',
    );
    const lassoElements = throwIfFailed(
      asResponse<Element[]>(await PluginCommAPI.getLassoElements()),
      'Failed to get lasso elements',
    );
    const pageSize = throwIfFailed(
      asResponse<Size>(await PluginFileAPI.getPageSize(filePath, page)),
      'Failed to get page size',
    );

    const fastPathPlan = await buildFastPathPlan(filePath, page, lassoElements, pageSize);
    if (fastPathPlan) {
      await executeFastPath(fastPathPlan);
      return;
    }

    await executeFallbackPageReplace(filePath, page, lassoElements, pageSize);
  } catch (error) {
    const message = describeError(error);
    console.error('Snap Shape failed', message, error);
    await showStatus(`Snap Shape failed:\n${message}`, false);
  } finally {
    isSnapping = false;
  }
}
