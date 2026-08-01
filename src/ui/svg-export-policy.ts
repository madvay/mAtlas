import type { LayoutName } from '../types.js';

export function includePassiveDomainOverlayInVisibleSvg(layout: LayoutName, overlayVisible: boolean): boolean {
  return layout === 'fields' && overlayVisible;
}
