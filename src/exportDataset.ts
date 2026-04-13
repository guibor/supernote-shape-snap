import {
  Element,
  FileUtils,
  NativeUIUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  PointUtils,
  type Point,
  type Rect,
} from 'sn-plugin-lib';
import {detectBestShape, type PointLike} from './shapeMatching';
import {writeUtf8File} from './native/exportFile';

export const EXPORT_SAMPLE_BUTTON_ID = 4201;
export const EXPORT_NOTE_BUTTON_ID = 4202;

const EXPORT_ROOT = '/storage/emulated/0/MyStyle/supernote_shape_snap_exports';
const SAMPLE_EXPORT_DIR = `${EXPORT_ROOT}/samples`;
const NOTE_EXPORT_DIR = `${EXPORT_ROOT}/notes`;

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
  isVisible?: boolean;
  name?: string;
};

type SerializedPoint = {
  x: number;
  y: number;
};

type SerializedStrokeElement = {
  kind: 'stroke';
  uuid: string;
  page_num: number;
  layer_num: number;
  num_in_page: number;
  user_data: string | null;
  thickness: number;
  recognition_name: string | null;
  pen_color: number;
  pen_type: number;
  sample_points_emr: SerializedPoint[];
  sample_points_px: SerializedPoint[];
  contour_groups_px: SerializedPoint[][];
};

type SerializedGeometryElement = {
  kind: 'geometry';
  uuid: string;
  page_num: number;
  layer_num: number;
  num_in_page: number;
  user_data: string | null;
  thickness: number;
  geometry_type: string | null;
  pen_color: number | null;
  pen_type: number | null;
  pen_width: number | null;
  points_px: SerializedPoint[];
  ellipse_center_px: SerializedPoint | null;
  ellipse_major_radius: number | null;
  ellipse_minor_radius: number | null;
  ellipse_angle: number | null;
};

type SerializedGenericElement = {
  kind: 'other';
  uuid: string;
  page_num: number;
  layer_num: number;
  num_in_page: number;
  user_data: string | null;
  thickness: number;
  element_type: number;
  recognition_name: string | null;
};

type SerializedElement =
  | SerializedStrokeElement
  | SerializedGeometryElement
  | SerializedGenericElement;

let isExporting = false;

function asResponse<T>(value: unknown): APIResponse<T> {
  return value as APIResponse<T>;
}

function throwIfFailed<T>(response: APIResponse<T>, context: string): T {
  if (!response?.success) {
    throw new Error(response?.error?.message ?? context);
  }

  return response.result as T;
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

function isNotePath(filePath: string): boolean {
  return /\.note$/i.test(filePath);
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || 'export';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function roundPoint(point: {x: number; y: number}, digits = 3): SerializedPoint {
  const factor = 10 ** digits;
  return {
    x: Math.round(point.x * factor) / factor,
    y: Math.round(point.y * factor) / factor,
  };
}

async function readAllAccessorItems<T>(
  accessor:
    | {
        size(): Promise<number>;
        getRange(startIndex: number, count: number): Promise<T[]>;
      }
    | null
    | undefined,
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

async function ensureDir(dirPath: string): Promise<void> {
  const success = await FileUtils.makeDir(dirPath);
  if (!success) {
    throw new Error(`Failed to create directory: ${dirPath}`);
  }
}

async function ensureExportDirs(): Promise<void> {
  await ensureDir(EXPORT_ROOT);
  await ensureDir(SAMPLE_EXPORT_DIR);
  await ensureDir(NOTE_EXPORT_DIR);
}

async function saveCurrentNoteIfNeeded(filePath: string): Promise<void> {
  if (!isNotePath(filePath)) {
    return;
  }

  const saveResponse = asResponse<boolean>(await PluginNoteAPI.saveCurrentNote());
  if (!saveResponse?.success) {
    console.warn('saveCurrentNote failed before export; continuing');
  }
}

async function showSuccessWithOpen(
  message: string,
  openPath: string,
): Promise<void> {
  try {
    const open = await NativeUIUtils.showRattaDialog(
      message,
      'Open folder',
      'OK',
      true,
    );
    if (open) {
      await FileUtils.openFilePath(openPath);
    }
  } catch (error) {
    console.warn('Failed to show export success dialog', describeError(error));
  }
}

async function showFailure(message: string): Promise<void> {
  try {
    await NativeUIUtils.showRattaDialog(message, 'OK', '', false);
  } catch (error) {
    console.warn('Failed to show export failure dialog', describeError(error));
  }
}

async function serializeStrokeElement(
  element: Element,
  pageSize: Size,
): Promise<SerializedStrokeElement> {
  const samplePointsEmr = await readAllAccessorItems<Point>(element.stroke?.points);
  const samplePointsPx = samplePointsEmr.map(point =>
    roundPoint(PointUtils.emrPoint2Android(point, pageSize)),
  );
  const contourGroups = await readAllAccessorItems<Point[]>(element.contoursSrc);
  const contourGroupsPx = contourGroups.map(group => group.map(point => roundPoint(point)));

  return {
    kind: 'stroke',
    uuid: element.uuid,
    page_num: element.pageNum ?? 0,
    layer_num: element.layerNum ?? 0,
    num_in_page: element.numInPage ?? -1,
    user_data: element.userData ?? null,
    thickness: element.thickness ?? 0,
    recognition_name: element.recognizeResult?.predict_name?.trim() || null,
    pen_color: element.stroke?.penColor ?? 0,
    pen_type: element.stroke?.penType ?? 0,
    sample_points_emr: samplePointsEmr.map(point => roundPoint(point, 0)),
    sample_points_px: samplePointsPx,
    contour_groups_px: contourGroupsPx,
  };
}

function serializeGeometryElement(element: Element): SerializedGeometryElement {
  return {
    kind: 'geometry',
    uuid: element.uuid,
    page_num: element.pageNum ?? 0,
    layer_num: element.layerNum ?? 0,
    num_in_page: element.numInPage ?? -1,
    user_data: element.userData ?? null,
    thickness: element.thickness ?? 0,
    geometry_type: element.geometry?.type ?? null,
    pen_color: element.geometry?.penColor ?? null,
    pen_type: element.geometry?.penType ?? null,
    pen_width: element.geometry?.penWidth ?? null,
    points_px: (element.geometry?.points ?? []).map(point => roundPoint(point)),
    ellipse_center_px: element.geometry?.ellipseCenterPoint
      ? roundPoint(element.geometry.ellipseCenterPoint)
      : null,
    ellipse_major_radius:
      element.geometry?.ellipseMajorAxisRadius ?? null,
    ellipse_minor_radius:
      element.geometry?.ellipseMinorAxisRadius ?? null,
    ellipse_angle: element.geometry?.ellipseAngle ?? null,
  };
}

async function serializeElement(
  element: Element,
  pageSize: Size,
): Promise<SerializedElement> {
  if (element.type === Element.TYPE_STROKE && element.stroke) {
    return serializeStrokeElement(element, pageSize);
  }

  if (element.type === Element.TYPE_GEO && element.geometry) {
    return serializeGeometryElement(element);
  }

  return {
    kind: 'other',
    uuid: element.uuid,
    page_num: element.pageNum ?? 0,
    layer_num: element.layerNum ?? 0,
    num_in_page: element.numInPage ?? -1,
    user_data: element.userData ?? null,
    thickness: element.thickness ?? 0,
    element_type: element.type,
    recognition_name: element.recognizeResult?.predict_name?.trim() || null,
  };
}

function buildMatcherPrediction(
  elements: SerializedElement[],
): ReturnType<typeof detectBestShape> | null {
  const strokes = elements.filter(
    element => element.kind === 'stroke',
  ) as SerializedStrokeElement[];

  if (!strokes.length || strokes.length !== elements.length) {
    return null;
  }

  return detectBestShape({
    samplePoints: strokes.flatMap(stroke =>
      stroke.contour_groups_px.flat().length >= 8
        ? stroke.contour_groups_px.flat()
        : stroke.sample_points_px,
    ) as PointLike[],
    strokePaths: strokes.map(stroke => stroke.sample_points_px as PointLike[]),
    recognitionNames: strokes
      .map(stroke => stroke.recognition_name)
      .filter(Boolean) as string[],
  });
}

async function generatePagePreview(
  filePath: string,
  page: number,
  pageSize: Size,
  pngPath: string,
): Promise<void> {
  if (isNotePath(filePath)) {
    const response = asResponse<boolean>(
      await PluginFileAPI.generateNotePng({
        notePath: filePath,
        page,
        times: 1,
        pngPath,
        type: 1,
      }),
    );
    throwIfFailed(response, 'Failed to generate note preview PNG');
    return;
  }

  const response = asResponse<boolean>(
    await PluginFileAPI.generateMarkThumbnails(filePath, page, pngPath, pageSize),
  );
  throwIfFailed(response, 'Failed to generate mark preview PNG');
}

function countElementsByKind(elements: SerializedElement[]): Record<string, number> {
  return elements.reduce<Record<string, number>>((accumulator, element) => {
    accumulator[element.kind] = (accumulator[element.kind] ?? 0) + 1;
    return accumulator;
  }, {});
}

export async function exportCurrentLassoSample(): Promise<void> {
  if (isExporting) {
    return;
  }

  isExporting = true;

  try {
    await ensureExportDirs();

    const filePath = throwIfFailed(
      asResponse<string>(await PluginCommAPI.getCurrentFilePath()),
      'Failed to get current file path',
    );
    const page = throwIfFailed(
      asResponse<number>(await PluginCommAPI.getCurrentPageNum()),
      'Failed to get current page number',
    );
    const lassoRect = throwIfFailed(
      asResponse<Rect>(await PluginCommAPI.getLassoRect()),
      'Failed to get lasso rect',
    );
    const lassoElements = throwIfFailed(
      asResponse<Element[]>(await PluginCommAPI.getLassoElements()),
      'Failed to get lasso elements',
    );
    const pageSize = throwIfFailed(
      asResponse<Size>(await PluginFileAPI.getPageSize(filePath, page)),
      'Failed to get page size',
    );

    if (!lassoElements.length) {
      await showFailure('Export Sample failed:\nNo lasso selection is active.');
      return;
    }

    await saveCurrentNoteIfNeeded(filePath);

    const fileBase = sanitizeName(stripExtension(basename(filePath)));
    const sampleId = `${fileBase}__p${String(page + 1).padStart(4, '0')}__${timestampToken()}`;
    const sampleJsonPath = `${SAMPLE_EXPORT_DIR}/${sampleId}.json`;
    const samplePngPath = `${SAMPLE_EXPORT_DIR}/${sampleId}.png`;

    const elements = await Promise.all(
      lassoElements.map(element => serializeElement(element, pageSize)),
    );
    const predicted = buildMatcherPrediction(elements);

    await generatePagePreview(filePath, page, pageSize, samplePngPath);

    const record = {
      format_version: 1,
      export_kind: 'lasso_sample',
      id: sampleId,
      exported_at: new Date().toISOString(),
      expected: null,
      tags: [],
      source_file_path: filePath,
      source_file_name: basename(filePath),
      page,
      page_size: pageSize,
      lasso_rect_px: lassoRect,
      page_preview_png: basename(samplePngPath),
      current_algorithm_prediction: predicted
        ? {
            kind: predicted.kind,
            score: predicted.score,
            diagnostics: predicted.diagnostics,
          }
        : null,
      element_counts: countElementsByKind(elements),
      elements,
    };

    await writeUtf8File(sampleJsonPath, JSON.stringify(record, null, 2));

    await showSuccessWithOpen(
      `Exported sample:\n${basename(sampleJsonPath)}\n\nFolder:\n${SAMPLE_EXPORT_DIR}`,
      SAMPLE_EXPORT_DIR,
    );
  } catch (error) {
    const message = describeError(error);
    console.error('Export Sample failed', message, error);
    await showFailure(`Export Sample failed:\n${message}`);
  } finally {
    isExporting = false;
  }
}

async function exportNotePageJson(
  notePath: string,
  exportDir: string,
  page: number,
): Promise<{
  page: number;
  page_size: Size;
  element_count: number;
  layer_count: number;
}> {
  const pageSize = throwIfFailed(
    asResponse<Size>(await PluginFileAPI.getPageSize(notePath, page)),
    `Failed to get page size for page ${page}`,
  );
  const elements = throwIfFailed(
    asResponse<Element[]>(await PluginFileAPI.getElements(page, notePath)),
    `Failed to get elements for page ${page}`,
  );
  const layers = throwIfFailed(
    asResponse<LayerInfo[]>(await PluginFileAPI.getLayers(notePath, page)),
    `Failed to get layers for page ${page}`,
  );

  const serialized = await Promise.all(
    elements.map(element => serializeElement(element, pageSize)),
  );

  const pageRecord = {
    format_version: 1,
    export_kind: 'note_page',
    note_path: notePath,
    page,
    page_size: pageSize,
    layers,
    element_counts: countElementsByKind(serialized),
    elements: serialized,
  };

  const pageFileName = `page-${String(page).padStart(4, '0')}.json`;
  await writeUtf8File(
    `${exportDir}/pages/${pageFileName}`,
    JSON.stringify(pageRecord, null, 2),
  );

  return {
    page,
    page_size: pageSize,
    element_count: serialized.length,
    layer_count: layers.length,
  };
}

export async function exportCurrentNoteDataset(): Promise<void> {
  if (isExporting) {
    return;
  }

  isExporting = true;

  try {
    await ensureExportDirs();

    const filePath = throwIfFailed(
      asResponse<string>(await PluginCommAPI.getCurrentFilePath()),
      'Failed to get current file path',
    );

    if (!isNotePath(filePath)) {
      await showFailure(
        'Export Note only supports .note files.\nUse Export Sample for DOC annotations.',
      );
      return;
    }

    await saveCurrentNoteIfNeeded(filePath);

    const pageCount = throwIfFailed(
      asResponse<number>(await PluginFileAPI.getNoteTotalPageNum(filePath)),
      'Failed to get note page count',
    );

    const exportId = `${sanitizeName(stripExtension(basename(filePath)))}__${timestampToken()}`;
    const exportDir = `${NOTE_EXPORT_DIR}/${exportId}`;
    const pagesDir = `${exportDir}/pages`;
    await ensureDir(exportDir);
    await ensureDir(pagesDir);

    const rawNoteCopyPath = `${exportDir}/${basename(filePath)}`;
    const copied = await FileUtils.copyFile(filePath, rawNoteCopyPath);
    if (!copied) {
      console.warn('Failed to copy raw note file to export bundle');
    }

    const pageSummaries = [];
    for (let page = 0; page < pageCount; page += 1) {
      const summary = await exportNotePageJson(filePath, exportDir, page);
      pageSummaries.push(summary);
    }

    const noteRecord = {
      format_version: 1,
      export_kind: 'note_bundle',
      id: exportId,
      exported_at: new Date().toISOString(),
      source_file_path: filePath,
      source_file_name: basename(filePath),
      raw_note_copy: basename(rawNoteCopyPath),
      page_count: pageCount,
      pages: pageSummaries,
    };

    await writeUtf8File(
      `${exportDir}/note.json`,
      JSON.stringify(noteRecord, null, 2),
    );

    await showSuccessWithOpen(
      `Exported note dataset:\n${exportId}\n\nFolder:\n${exportDir}`,
      exportDir,
    );
  } catch (error) {
    const message = describeError(error);
    console.error('Export Note failed', message, error);
    await showFailure(`Export Note failed:\n${message}`);
  } finally {
    isExporting = false;
  }
}
