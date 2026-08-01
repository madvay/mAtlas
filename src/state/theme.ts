import type { ResolvedTheme, ThemePreference } from '../types.js';

export const DARK_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export const THEME_BROWSER_COLORS: Readonly<Record<ResolvedTheme, string>> = Object.freeze({
  light: '#f6f7f9',
  dark: '#0b1020'
});

export function resolveThemePreference(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

export function applyDocumentTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
  documentObject: Document = document
): ResolvedTheme {
  const resolved = resolveThemePreference(preference, systemPrefersDark);
  const root = documentObject.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  const themeMeta = documentObject.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = THEME_BROWSER_COLORS[resolved];
  return resolved;
}
