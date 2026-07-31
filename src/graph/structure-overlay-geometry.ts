import type { Point } from '../types.js';
import type { SemanticMapScale } from './semantic-map-core.js';

export interface StructureBounds {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

export interface StructureViewport {
  width: number;
  height: number;
}

export interface StructureNodeVisualMetrics {
  width: number;
  height: number;
  fontSize: number;
  textOutlineWidth: number;
  selectedTextOutlineWidth: number;
  textWidth: number;
  labelLines: string[];
  renderedWidth: number;
  renderedHeight: number;
  renderedFontSize: number;
}

export interface StructurePositionItem {
  id: string;
  anchor: Point;
  width: number;
  height: number;
}

export interface StructureEdgeVisualMetrics {
  width: number;
  selectedWidth: number;
  curveDistance: number;
  arrowSize: number;
  renderedWidth: number;
}

const MIN_FIT_ZOOM = 0.015;
const MAX_FIT_ZOOM = 1.5;
// A structure label is authored in Layered graph coordinates, not viewport
// pixels. At roughly this zoom a single-field graph reproduces the intended
// reading size; wider/taller selections then scale down naturally with the map.
const STRUCTURE_LABEL_REFERENCE_ZOOM = 0.11;
// Preserve the established aggregate-edge weight at a 1720 × 911 desktop
// viewport (1720 × 824 graph canvas), then let the map zoom scale it with the
// semantic labels on smaller canvases.
const STRUCTURE_EDGE_REFERENCE_ZOOM = 0.043;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function textCharacterWeight(character: string): number {
  if (character === ' ') return 0.31;
  if ('ilI|!.,:;\''.includes(character)) return 0.3;
  if ('MWmw@%&'.includes(character)) return 0.9;
  if ('fjrt()[]{}'.includes(character)) return 0.42;
  return character === character.toUpperCase() && character !== character.toLowerCase() ? 0.66 : 0.56;
}

export function estimatedTextWidth(text: string, fontSize: number): number {
  return [...text].reduce((sum, character) => sum + textCharacterWeight(character) * fontSize, 0);
}

function wrapWords(label: string, fontSize: number, maximumWidth: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || estimatedTextWidth(candidate, fontSize) <= maximumWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function fitLabel(
  label: string,
  width: number,
  height: number,
  desiredFontSize: number,
  minimumFontSize: number,
  maximumLines: number
): { fontSize: number; lines: string[] } {
  const maximumWidth = width * 0.84;
  const maximumHeight = height * 0.76;
  for (let fontSize = desiredFontSize; fontSize >= minimumFontSize; fontSize -= 0.5) {
    const lines = wrapWords(label, fontSize, maximumWidth);
    if (lines.length <= maximumLines
      && lines.every((line) => estimatedTextWidth(line, fontSize) <= maximumWidth)
      && lines.length * fontSize * 1.06 <= maximumHeight) {
      return { fontSize, lines };
    }
  }
  return { fontSize: minimumFontSize, lines: wrapWords(label, minimumFontSize, maximumWidth) };
}

export function estimateStructureFitZoom(bounds: StructureBounds, viewport: StructureViewport): number {
  const availableWidth = Math.max(1, viewport.width - 220);
  const availableHeight = Math.max(1, viewport.height - 250);
  const contentWidth = Math.max(1, bounds.w + 164);
  const contentHeight = Math.max(1, bounds.h + 58);
  const estimate = Math.min(availableWidth / contentWidth, availableHeight / contentHeight) * 0.92;
  return clamp(estimate, MIN_FIT_ZOOM, MAX_FIT_ZOOM);
}

export function structureNodeVisualMetrics(
  scale: SemanticMapScale,
  conceptCount: number,
  label: string,
  estimatedFitZoom: number
): StructureNodeVisualMetrics {
  const zoom = clamp(estimatedFitZoom, MIN_FIT_ZOOM, MAX_FIT_ZOOM);
  const count = Math.max(1, conceptCount);
  const sizeSignal = Math.log2(count + 1);

  // Define the label once in stable graph coordinates. The former implementation
  // divided every dimension by the current fit zoom, which made a two-field map
  // inflate its graph-space labels enough to cancel the camera's zoom-out.
  // Stable geometry preserves the centroid relationship and lets labels become
  // smaller on screen whenever the visible atlas spans a larger extent.
  const referenceFontSize = scale === 'fields'
    ? clamp(27 + sizeSignal * 1.15, 30, 38)
    : clamp(15.5 + sizeSignal * 0.9, 17.5, 23);
  const minimumReferenceFontSize = scale === 'fields' ? 28 : 16.5;
  const maximumReferenceWidth = scale === 'fields'
    ? clamp(190 + sizeSignal * 10, 220, 275)
    : clamp(108 + sizeSignal * 8.5, 124, 170);
  const maximumLines = scale === 'fields' ? 2 : 3;
  const fitted = fitLabel(
    label,
    maximumReferenceWidth,
    referenceFontSize * maximumLines * 1.12,
    referenceFontSize,
    minimumReferenceFontSize,
    maximumLines
  );
  const referenceTextWidth = Math.max(
    1,
    ...fitted.lines.map((line) => estimatedTextWidth(line, fitted.fontSize))
  );
  const referenceWidth = Math.min(maximumReferenceWidth, referenceTextWidth + 10);
  const referenceHeight = fitted.lines.length * fitted.fontSize * 1.06 + 8;
  const width = referenceWidth / STRUCTURE_LABEL_REFERENCE_ZOOM;
  const height = referenceHeight / STRUCTURE_LABEL_REFERENCE_ZOOM;
  const fontSize = fitted.fontSize / STRUCTURE_LABEL_REFERENCE_ZOOM;
  return {
    width,
    height,
    fontSize,
    textOutlineWidth: 1.15 / STRUCTURE_LABEL_REFERENCE_ZOOM,
    selectedTextOutlineWidth: 2.25 / STRUCTURE_LABEL_REFERENCE_ZOOM,
    textWidth: maximumReferenceWidth / STRUCTURE_LABEL_REFERENCE_ZOOM,
    labelLines: fitted.lines,
    renderedWidth: width * zoom,
    renderedHeight: height * zoom,
    renderedFontSize: fontSize * zoom
  };
}

export function structureNodeGap(scale: SemanticMapScale, _estimatedFitZoom: number): number {
  return (scale === 'fields' ? 18 : 10) / STRUCTURE_LABEL_REFERENCE_ZOOM;
}

export function structureEdgeVisualMetrics(
  scale: SemanticMapScale,
  relationCount: number,
  estimatedFitZoom: number
): StructureEdgeVisualMetrics {
  const zoom = clamp(estimatedFitZoom, MIN_FIT_ZOOM, MAX_FIT_ZOOM);
  const count = Math.max(1, relationCount);
  const referenceRenderedWidth = clamp(2.4 + Math.log2(count + 1) * 1.35, 3.2, 13.5) * 0.6;
  const width = referenceRenderedWidth / STRUCTURE_EDGE_REFERENCE_ZOOM;
  const renderedCurveDistance = scale === 'fields' ? 72 : 46;
  return {
    // Author aggregate-edge thickness in the same stable graph coordinates as
    // the semantic labels. Dividing by the live fit zoom made edge thickness a
    // screen-space constant, so mobile maps had tiny labels beside desktop-size
    // strokes. The reference zoom preserves the established desktop proportion
    // while allowing labels, strokes, selection emphasis, and arrows to scale
    // down together on smaller viewports.
    width,
    selectedWidth: (referenceRenderedWidth + 3.4) / STRUCTURE_EDGE_REFERENCE_ZOOM,
    // Cytoscape defines the control-point side relative to the directed
    // source→target vector. Keeping the same sign means reversing an edge also
    // reverses the perpendicular, placing reciprocal arrows on opposite sides.
    curveDistance: renderedCurveDistance / zoom,
    arrowSize: Math.max(10, referenceRenderedWidth * 1.7) / STRUCTURE_EDGE_REFERENCE_ZOOM,
    renderedWidth: width * zoom
  };
}

function coincidentDirection(leftId: string, rightId: string): Point {
  const text = `${leftId}|${rightId}`;
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const angle = (hash >>> 0) / 0xffffffff * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function deconflictStructurePositions(
  items: readonly StructurePositionItem[],
  gap: number
): Map<string, Point> {
  const ordered = [...items].sort((left, right) => left.id.localeCompare(right.id));
  const positions = new Map(ordered.map((item) => [item.id, { ...item.anchor }]));
  const separate = (): number => {
    let overlapCount = 0;
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      const left = ordered[leftIndex];
      if (!left) continue;
      const leftPosition = positions.get(left.id);
      if (!leftPosition) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const right = ordered[rightIndex];
        if (!right) continue;
        const rightPosition = positions.get(right.id);
        if (!rightPosition) continue;
        let dx = rightPosition.x - leftPosition.x;
        let dy = rightPosition.y - leftPosition.y;
        const requiredX = (left.width + right.width) / 2 + gap;
        const requiredY = (left.height + right.height) / 2 + gap;
        const overlapX = requiredX - Math.abs(dx);
        const overlapY = requiredY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        overlapCount += 1;

        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
          const direction = coincidentDirection(left.id, right.id);
          dx = direction.x;
          dy = direction.y;
        }
        if (overlapX <= overlapY) {
          const direction = dx < 0 ? -1 : 1;
          const displacement = overlapX / 2 + 0.01;
          leftPosition.x -= direction * displacement;
          rightPosition.x += direction * displacement;
        } else {
          const direction = dy < 0 ? -1 : 1;
          const displacement = overlapY / 2 + 0.01;
          leftPosition.y -= direction * displacement;
          rightPosition.y += direction * displacement;
        }
      }
    }
    return overlapCount;
  };

  for (let iteration = 0; iteration < 48; iteration += 1) {
    separate();
    for (const item of ordered) {
      const position = positions.get(item.id);
      if (!position) continue;
      position.x = item.anchor.x + (position.x - item.anchor.x) * 0.86;
      position.y = item.anchor.y + (position.y - item.anchor.y) * 0.86;
    }
  }
  for (let iteration = 0; iteration < 48 && separate() > 0; iteration += 1) {
    // Final collision-only passes guarantee rectangle clearance.
  }
  return positions;
}
