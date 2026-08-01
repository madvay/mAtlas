import type cytoscape from 'cytoscape';
import type { LayoutName } from '../types.js';

interface ViewportTextureRenderer {
  textureOnViewport: boolean;
  textureCache?: unknown;
}

/**
 * Domain structure mode has enough large outlined centroid labels that
 * rerasterising them on every wheel-zoom frame is noticeably more expensive
 * than transforming Cytoscape's cached viewport texture.  Other layouts stay
 * on the normal renderer path so their already-smooth interaction and crisp
 * live rendering are unchanged.
 */
export function useViewportTextureForLayout(layout: LayoutName): boolean {
  return layout === 'domains';
}

export function applyLayoutViewportRendering(cy: cytoscape.Core, layout: LayoutName): boolean {
  const renderer = (cy as unknown as { renderer: () => ViewportTextureRenderer }).renderer();
  const textureOnViewport = useViewportTextureForLayout(layout);
  if (renderer.textureOnViewport === textureOnViewport) return false;

  renderer.textureOnViewport = textureOnViewport;
  // A texture belongs to the viewport and element state in which it was made.
  // Never carry one across a layout-mode boundary.
  renderer.textureCache = undefined;
  return true;
}
