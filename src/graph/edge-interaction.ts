import type cytoscape from 'cytoscape';

const EDGE_ZOOM_ACTIVATION_THRESHOLD = 0.65;

// Keep this as an event-handler predicate. Encoding the threshold in each
// edge's `events` style turns one zoom-boundary crossing into an O(E) restyle.
export function edgeInteractionEnabled(edgeZoomActivation: boolean, zoom: number): boolean {
  return !edgeZoomActivation || zoom >= EDGE_ZOOM_ACTIVATION_THRESHOLD;
}

/**
 * Cytoscape performs its built-in tap selection after delegated `tap`
 * handlers return. Temporarily making only the tapped edge unselectable keeps
 * that later selection phase from applying `:selected` styles. Restoring in a
 * microtask leaves normal programmatic and zoomed-in selection unchanged.
 */
export function suppressAutomaticSelectionForCurrentTap(edge: cytoscape.SingularElementReturnValue): void {
  if (!edge.selectable()) return;
  edge.unselectify();
  queueMicrotask(() => {
    if (!edge.removed()) edge.selectify();
  });
}
