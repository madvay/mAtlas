import type { Preferences } from '../types.js';

export const PREFERENCES_STORAGE_KEY = 'human-knowledge-atlas:preferences:v1';

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  version: 1,
  highResolution: true,
  transitions: true,
  animateGraph: false,
  motionBlur: false,
  formulaeInGraph: false,
  indicateOtherDomains: true,
  hideEdgesWhileMoving: true,
  allowNodeMovement: false,
  dimPrerequisites: true,
  highlightPrerequisites: false,
  experimentalFeatures: false
});

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFERENCES };
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1) return { ...DEFAULT_PREFERENCES };
    return {
      version: 1,
      highResolution: typeof candidate.highResolution === 'boolean' ? candidate.highResolution : true,
      transitions: typeof candidate.transitions === 'boolean' ? candidate.transitions : true,
      animateGraph: typeof candidate.animateGraph === 'boolean' ? candidate.animateGraph : false,
      motionBlur: typeof candidate.motionBlur === 'boolean' ? candidate.motionBlur : false,
      formulaeInGraph: typeof candidate.formulaeInGraph === 'boolean' ? candidate.formulaeInGraph : false,
      indicateOtherDomains: typeof candidate.indicateOtherDomains === 'boolean' ? candidate.indicateOtherDomains : true,
      hideEdgesWhileMoving: typeof candidate.hideEdgesWhileMoving === 'boolean' ? candidate.hideEdgesWhileMoving : true,
      allowNodeMovement: typeof candidate.allowNodeMovement === 'boolean' ? candidate.allowNodeMovement : false,
      dimPrerequisites: typeof candidate.dimPrerequisites === 'boolean' ? candidate.dimPrerequisites : true,
      highlightPrerequisites: typeof candidate.highlightPrerequisites === 'boolean' ? candidate.highlightPrerequisites : false,
      experimentalFeatures: typeof candidate.experimentalFeatures === 'boolean' ? candidate.experimentalFeatures : false
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
