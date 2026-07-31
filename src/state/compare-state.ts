import type { ConnectionDirection } from '../graph/connection-path.js';
import type { GraphNode } from '../types.js';

export const COMPARE_PAIR_PARAM = 'compare';
export const COMPARE_MODE_PARAM = 'compareMode';
export const COMPARE_DIRECTION_PARAM = 'compareDirection';
export const COMPARE_PATH_PARAM = 'comparePath';

export type CompareMode = 'overview' | 'connections';

export interface CompareState {
  nodeIds: readonly [string, string];
  mode: CompareMode;
  direction: ConnectionDirection;
  pathIndex: number;
}

export function defaultCompareState(nodeIds: readonly [string, string]): CompareState {
  return { nodeIds, mode: 'overview', direction: 'either', pathIndex: 0 };
}

export function sameCompareState(left: CompareState | null, right: CompareState | null): boolean {
  return left === right || Boolean(left && right
    && left.nodeIds[0] === right.nodeIds[0]
    && left.nodeIds[1] === right.nodeIds[1]
    && left.mode === right.mode
    && left.direction === right.direction
    && left.pathIndex === right.pathIndex);
}

export function readCompareState(
  params: URLSearchParams,
  nodeRecord: ReadonlyMap<string, GraphNode>
): CompareState | null {
  const rawPair = params.get(COMPARE_PAIR_PARAM)?.trim();
  if (!rawPair) return null;
  const parts = rawPair.split(',').map((value) => value.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const [leftId, rightId] = parts;
  if (!leftId || !rightId || leftId === rightId) return null;
  const left = nodeRecord.get(leftId);
  const right = nodeRecord.get(rightId);
  if (left?.kind !== 'structure' || right?.kind !== 'structure') return null;

  const mode = params.get(COMPARE_MODE_PARAM) === 'connections' ? 'connections' : 'overview';
  const direction = mode === 'connections' && params.get(COMPARE_DIRECTION_PARAM) === 'forward' ? 'forward' : 'either';
  const parsedPathIndex = mode === 'connections' ? Number.parseInt(params.get(COMPARE_PATH_PARAM) ?? '0', 10) : 0;
  return {
    nodeIds: [left.id, right.id],
    mode,
    direction,
    pathIndex: Number.isFinite(parsedPathIndex) && parsedPathIndex >= 0 ? parsedPathIndex : 0
  };
}

export function readCompareStateFromLocation(
  location: Pick<Location, 'href'>,
  nodeRecord: ReadonlyMap<string, GraphNode>
): CompareState | null {
  return readCompareState(new URL(location.href).searchParams, nodeRecord);
}

export function writeCompareState(params: URLSearchParams, state: CompareState | null): void {
  for (const name of [COMPARE_PAIR_PARAM, COMPARE_MODE_PARAM, COMPARE_DIRECTION_PARAM, COMPARE_PATH_PARAM]) {
    params.delete(name);
  }
  if (!state) return;
  params.set(COMPARE_PAIR_PARAM, `${state.nodeIds[0]},${state.nodeIds[1]}`);
  if (state.mode === 'connections') {
    params.set(COMPARE_MODE_PARAM, 'connections');
    if (state.direction === 'forward') params.set(COMPARE_DIRECTION_PARAM, 'forward');
    if (state.pathIndex > 0) params.set(COMPARE_PATH_PARAM, String(state.pathIndex));
  }
}
