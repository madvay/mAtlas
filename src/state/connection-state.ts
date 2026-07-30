import type { ConnectionDirection } from '../graph/connection-path.js';

export const CONNECTION_FROM_PARAM = 'connectFrom';
export const CONNECTION_TO_PARAM = 'connectTo';
export const CONNECTION_DIRECTION_PARAM = 'connectDir';
export const CONNECTION_PATH_PARAM = 'connectPath';

export interface ConnectionQueryState {
  sourceId: string;
  targetId: string;
  direction: ConnectionDirection;
  pathIndex: number;
}

export function readConnectionQueryState(
  params: URLSearchParams,
  knownNodeIds: ReadonlySet<string>
): ConnectionQueryState | null {
  const sourceId = params.get(CONNECTION_FROM_PARAM);
  const targetId = params.get(CONNECTION_TO_PARAM);
  if (!sourceId || !targetId || sourceId === targetId || !knownNodeIds.has(sourceId) || !knownNodeIds.has(targetId)) return null;
  const direction = params.get(CONNECTION_DIRECTION_PARAM) === 'forward' ? 'forward' : 'either';
  const parsedPathIndex = Number.parseInt(params.get(CONNECTION_PATH_PARAM) ?? '0', 10);
  return {
    sourceId,
    targetId,
    direction,
    pathIndex: Number.isFinite(parsedPathIndex) && parsedPathIndex >= 0 ? parsedPathIndex : 0
  };
}

export function writeConnectionQueryState(params: URLSearchParams, state: ConnectionQueryState | null): void {
  for (const name of [CONNECTION_FROM_PARAM, CONNECTION_TO_PARAM, CONNECTION_DIRECTION_PARAM, CONNECTION_PATH_PARAM]) {
    params.delete(name);
  }
  if (!state) return;
  params.set(CONNECTION_FROM_PARAM, state.sourceId);
  params.set(CONNECTION_TO_PARAM, state.targetId);
  if (state.direction === 'forward') params.set(CONNECTION_DIRECTION_PARAM, 'forward');
  if (state.pathIndex > 0) params.set(CONNECTION_PATH_PARAM, String(state.pathIndex));
}

export function copyConnectionQueryState(source: URLSearchParams, target: URLSearchParams): void {
  const sourceId = source.get(CONNECTION_FROM_PARAM);
  const targetId = source.get(CONNECTION_TO_PARAM);
  if (!sourceId || !targetId) return;
  target.set(CONNECTION_FROM_PARAM, sourceId);
  target.set(CONNECTION_TO_PARAM, targetId);
  const direction = source.get(CONNECTION_DIRECTION_PARAM);
  if (direction) target.set(CONNECTION_DIRECTION_PARAM, direction);
  const pathIndex = source.get(CONNECTION_PATH_PARAM);
  if (pathIndex) target.set(CONNECTION_PATH_PARAM, pathIndex);
}
