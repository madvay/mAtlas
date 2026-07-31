import type cytoscape from 'cytoscape';

const MARKER_SIZE = 9;
const MARKER_GAP = 3;
const MARKER_RIGHT_INSET = 10;
const MARKER_BOTTOM_INSET = 8;
const markerImageCache = new Map<string, string>();
const markerOffsetCache = new Map<number, string[]>();
const markerValueCache = new Map<string, unknown[]>();

function secondaryDomainColors(node: cytoscape.NodeSingular): string[] {
  const colors = node.data('domainColors');
  if (!Array.isArray(colors) || colors.length < 2) return [];
  return colors.slice(1).map((color) => String(color));
}

function secondaryDomainCount(node: cytoscape.NodeSingular): number {
  const stored = Number(node.data('secondaryDomainCount'));
  if (Number.isInteger(stored) && stored >= 0) return stored;
  return secondaryDomainColors(node).length;
}

function escapeSvgAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function markerImage(color: string): string {
  const cached = markerImageCache.get(color);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MARKER_SIZE}" height="${MARKER_SIZE}" viewBox="0 0 ${MARKER_SIZE} ${MARKER_SIZE}"><circle cx="4.5" cy="4.5" r="4.5" fill="${escapeSvgAttribute(color)}"/></svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  markerImageCache.set(color, uri);
  return uri;
}

export function secondaryDomainMarkerImages(node: cytoscape.NodeSingular): string[] {
  return secondaryDomainColors(node).map(markerImage);
}

export function secondaryDomainMarkerHorizontalOffsets(node: cytoscape.NodeSingular): string[] {
  const count = secondaryDomainCount(node);
  const cached = markerOffsetCache.get(count);
  if (cached) return cached;
  const offsets = Array.from({ length: count }, (_unused, index) => {
    const markersToRight = count - index - 1;
    return `${-MARKER_RIGHT_INSET - markersToRight * (MARKER_SIZE + MARKER_GAP)}px`;
  });
  markerOffsetCache.set(count, offsets);
  return offsets;
}

export function secondaryDomainMarkerValues<T>(node: cytoscape.NodeSingular, value: T): T[] {
  const count = secondaryDomainCount(node);
  const key = `${count}:${typeof value}:${String(value)}`;
  const cached = markerValueCache.get(key);
  if (cached) return cached as T[];
  const values = Array.from({ length: count }, () => value);
  markerValueCache.set(key, values);
  return values;
}

export const SECONDARY_DOMAIN_MARKER_BOTTOM_OFFSET = `${-MARKER_BOTTOM_INSET}px`;
export const SECONDARY_DOMAIN_MARKER_SIZE = MARKER_SIZE;
