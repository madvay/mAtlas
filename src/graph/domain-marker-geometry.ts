export const DOMAIN_MARKER_DIAMETER = 9;
export const DOMAIN_MARKER_RADIUS = DOMAIN_MARKER_DIAMETER / 2;
export const DOMAIN_MARKER_GAP = 3;
export const DOMAIN_MARKER_STEP = DOMAIN_MARKER_DIAMETER + DOMAIN_MARKER_GAP;
export const DOMAIN_MARKER_RIGHT_OFFSET = 76;
export const DOMAIN_MARKER_BOTTOM_OFFSET = 25;

export interface DomainMarkerOrigin {
  x: number;
  y: number;
}

export function domainMarkerTopLeft(position: DomainMarkerOrigin, count: number): DomainMarkerOrigin {
  const width = count > 0 ? count * DOMAIN_MARKER_DIAMETER + (count - 1) * DOMAIN_MARKER_GAP : 0;
  return {
    x: position.x + DOMAIN_MARKER_RIGHT_OFFSET - width,
    y: position.y + DOMAIN_MARKER_BOTTOM_OFFSET - DOMAIN_MARKER_DIAMETER
  };
}
