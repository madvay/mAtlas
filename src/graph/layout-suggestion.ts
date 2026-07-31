import { COMPACT_HIERARCHY_COLUMN_SPACING } from './compact-hierarchy-layout-core.js';

export interface CompactLayoutSuggestionMetrics {
  width: number;
  height: number;
  nodeCount: number;
  displayedNodeCount: number;
  levelCounts: readonly number[];
}

/**
 * Suggest Compact only when Layered is materially sparse, not merely large.
 * The packed-width comparison estimates the widest Compact row using the same
 * canonical column spacing as the actual layout.
 */
export function compactLayoutWouldHelp(metrics: CompactLayoutSuggestionMetrics): boolean {
  const { width, height, nodeCount, displayedNodeCount, levelCounts } = metrics;
  if (displayedNodeCount >= 200 || nodeCount < 18 || levelCounts.length < 3 || width <= 0 || height <= 0) return false;
  if (width / height < 1.45) return false;
  const widestRowCount = Math.max(...levelCounts);
  const estimatedPackedWidth = Math.max(164, (widestRowCount - 1) * COMPACT_HIERARCHY_COLUMN_SPACING + 164);
  const horizontalWaste = 1 - estimatedPackedWidth / width;
  return horizontalWaste >= 0.36;
}
