export const ABSOLUTE_MIN_ZOOM = 0.005;
export const DEFAULT_INTERACTIVE_MIN_ZOOM = 0.08;
export const FIT_SAFETY_SCALE = 0.98;

export interface FitBoundingBox {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitViewport {
  zoom: number;
  pan: { x: number; y: number };
}

export function calculateFitViewport(
  box: FitBoundingBox,
  viewport: ViewportSize,
  insets: ViewportInsets,
  margins: FitMargins,
  padding: number,
  minZoom: number,
  maxZoom: number,
  fitScale = 1
): FitViewport | null {
  const targetLeft = insets.left + margins.left + padding;
  const targetTop = insets.top + margins.top + padding;
  const targetRight = viewport.width - insets.right - margins.right - padding;
  const targetBottom = viewport.height - insets.bottom - margins.bottom - padding;
  const targetWidth = targetRight - targetLeft;
  const targetHeight = targetBottom - targetTop;
  if (targetWidth <= 0 || targetHeight <= 0 || box.w <= 0 || box.h <= 0) return null;

  if (!Number.isFinite(fitScale) || fitScale <= 0 || fitScale > 1) return null;

  const unclampedZoom = Math.min(targetWidth / box.w, targetHeight / box.h) * fitScale;
  const zoom = Math.max(minZoom, Math.min(maxZoom, unclampedZoom));
  const targetCenterX = (targetLeft + targetRight) / 2;
  const targetCenterY = (targetTop + targetBottom) / 2;
  const boxCenterX = box.x1 + box.w / 2;
  const boxCenterY = box.y1 + box.h / 2;
  return {
    zoom,
    pan: {
      x: targetCenterX - boxCenterX * zoom,
      y: targetCenterY - boxCenterY * zoom
    }
  };
}

export function minimumZoomForFit(
  fitZoom: number,
  interactiveMinZoom = DEFAULT_INTERACTIVE_MIN_ZOOM,
  absoluteMinZoom = ABSOLUTE_MIN_ZOOM
): number {
  return Math.max(absoluteMinZoom, Math.min(interactiveMinZoom, fitZoom));
}
