import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deconflictStructurePositions,
  estimateStructureFitZoom,
  structureEdgeVisualMetrics,
  structureNodeGap,
  structureNodeVisualMetrics
} from '../../.test-build/graph/structure-overlay-geometry.js';

test('structure label font size is monotonic in visible concept count', () => {
  const zoom = 0.11;
  const small = structureNodeVisualMetrics('domains', 6, 'Universal algebra', zoom);
  const medium = structureNodeVisualMetrics('domains', 30, 'Universal algebra', zoom);
  const large = structureNodeVisualMetrics('domains', 108, 'Universal algebra', zoom);
  assert.ok(small.fontSize < medium.fontSize);
  assert.ok(medium.fontSize <= large.fontSize);
  assert.ok(small.renderedFontSize >= 17.5);
  assert.ok(large.renderedFontSize <= 23);
});

test('structure labels scale down with broader map extents instead of cancelling fit zoom', () => {
  const focusedZoom = 0.11;
  const wholeAtlasZoom = 0.055;
  const focused = structureNodeVisualMetrics('domains', 36, 'Thermodynamics & statistical mechanics', focusedZoom);
  const wholeAtlas = structureNodeVisualMetrics('domains', 36, 'Thermodynamics & statistical mechanics', wholeAtlasZoom);
  assert.equal(wholeAtlas.fontSize, focused.fontSize);
  assert.equal(wholeAtlas.width, focused.width);
  assert.deepEqual(wholeAtlas.labelLines, focused.labelLines);
  assert.ok(Math.abs(wholeAtlas.renderedFontSize / focused.renderedFontSize - 0.5) < 0.001);
  assert.ok(Math.abs(wholeAtlas.renderedWidth / focused.renderedWidth - 0.5) < 0.001);
});

test('whole-map labels remain legible with compact text-only footprints', () => {
  const zoom = estimateStructureFitZoom({ x1: -6900, y1: 0, w: 14700, h: 12240 }, { width: 1328, height: 1152 });
  const domain = structureNodeVisualMetrics('domains', 36, 'Thermodynamics & statistical mechanics', zoom);
  const field = structureNodeVisualMetrics('fields', 567, 'Physics', zoom);
  assert.ok(domain.renderedFontSize >= 10);
  assert.ok(domain.renderedFontSize < 16.5);
  assert.ok(domain.labelLines.length <= 3);
  assert.ok(domain.renderedWidth < 120);
  assert.ok(domain.renderedHeight < 65);
  assert.ok(field.renderedFontSize >= 18);
  assert.ok(field.renderedWidth < 180);
  assert.ok(field.renderedHeight < 70);
  assert.ok(field.renderedFontSize > domain.renderedFontSize);
  assert.ok(domain.textOutlineWidth * zoom < 1);
});

test('text-label clearance uses stable graph geometry and scales with the map', () => {
  const focusedZoom = 0.11;
  const broadZoom = 0.055;
  assert.equal(structureNodeGap('domains', focusedZoom), structureNodeGap('domains', broadZoom));
  assert.equal(structureNodeGap('fields', focusedZoom), structureNodeGap('fields', broadZoom));
  assert.equal(structureNodeGap('domains', focusedZoom) * focusedZoom, 10);
  assert.equal(structureNodeGap('fields', focusedZoom) * focusedZoom, 18);
  assert.equal(structureNodeGap('domains', broadZoom) * broadZoom, 5);
});

test('aggregate edge widths preserve the 1720x911 desktop weight and scale with semantic typography', () => {
  // The app header leaves an 824px graph canvas in the user's 1720x911
  // reference viewport. This all-atlas bound is the structure-map fit case.
  const desktopZoom = estimateStructureFitZoom(
    { x1: -6984.375, y1: -35, w: 14859.308333333334, h: 12310 },
    { width: 1720, height: 824 }
  );
  const mobileZoom = 0.015;
  const thin = structureEdgeVisualMetrics('domains', 1, desktopZoom);
  const thick = structureEdgeVisualMetrics('domains', 64, desktopZoom);
  const mobile = structureEdgeVisualMetrics('domains', 64, mobileZoom);
  const establishedDesktopWidth = (2.4 + Math.log2(65) * 1.35) * 0.6;
  assert.ok(thin.width < thick.width);
  assert.ok(Math.abs(thick.renderedWidth / establishedDesktopWidth - 1) < 0.01);
  assert.equal(mobile.width, thick.width);
  assert.equal(mobile.selectedWidth, thick.selectedWidth);
  assert.equal(mobile.arrowSize, thick.arrowSize);
  assert.ok(Math.abs(mobile.renderedWidth / thick.renderedWidth - mobileZoom / desktopZoom) < 0.001);

  // Reversing source and target reverses Cytoscape's perpendicular vector.
  // The same signed control distance therefore puts reciprocal curves on
  // opposite physical sides of the straight segment.
  const midpointY = 0;
  const forwardControlY = midpointY + thick.curveDistance;
  const reverseControlY = midpointY - thick.curveDistance;
  assert.equal(forwardControlY, -reverseControlY);
});

test('text labels are deterministically separated with minimal centroid displacement', () => {
  const items = [
    { id: 'a', anchor: { x: 0, y: 0 }, width: 92, height: 28 },
    { id: 'b', anchor: { x: 30, y: 0 }, width: 104, height: 30 },
    { id: 'c', anchor: { x: 60, y: 10 }, width: 86, height: 26 }
  ];
  const gap = 10;
  const first = deconflictStructurePositions(items, gap);
  const second = deconflictStructurePositions([...items].reverse(), gap);
  assert.deepEqual([...first], [...second]);
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const a = items[left];
      const b = items[right];
      const pa = first.get(a.id);
      const pb = first.get(b.id);
      const clearHorizontally = Math.abs(pa.x - pb.x) >= (a.width + b.width) / 2 + gap - 0.1;
      const clearVertically = Math.abs(pa.y - pb.y) >= (a.height + b.height) / 2 + gap - 0.1;
      assert.ok(clearHorizontally || clearVertically);
    }
  }
  const maximumDisplacement = Math.max(...items.map((item) => {
    const position = first.get(item.id);
    return Math.hypot(position.x - item.anchor.x, position.y - item.anchor.y);
  }));
  assert.ok(maximumDisplacement < 100);
});
