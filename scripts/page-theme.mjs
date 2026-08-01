export const themeBootstrapScript = `<script>
(() => {
  let preference = 'system';
  try {
    const value = JSON.parse(window.localStorage.getItem('human-knowledge-atlas:preferences:v1') || 'null');
    if (value?.version === 1 && (value.theme === 'light' || value.theme === 'dark' || value.theme === 'system')) preference = value.theme;
  } catch { /* use system */ }
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = preference === 'dark' || (preference === 'system' && query.matches);
    const resolved = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0b1020' : '#f6f7f9';
  };
  apply();
  if (preference === 'system') query.addEventListener?.('change', apply);
})();
</script>`;

export const staticThemeCss = `
:root{color-scheme:light;--page-bg:#f5f7fb;--panel:#fff;--panel-2:#fbfcfe;--text:#172033;--heading:#0f172a;--muted:#536075;--muted-2:#596579;--line:#d7dee9;--line-soft:#e1e6ef;--link:#1746a2;--primary:#1e40af;--accent-soft:#eff6ff;--accent-text:#1e3a8a;--figure-bg:#e9eef6;--shadow:0 10px 35px rgba(15,23,42,.16)}
:root[data-theme="dark"]{color-scheme:dark;--page-bg:#0b1020;--panel:#111827;--panel-2:#0b1220;--text:#e5e7eb;--heading:#f8fafc;--muted:#aab7ca;--muted-2:#94a3b8;--line:#2b3547;--line-soft:#334155;--link:#93c5fd;--primary:#2563eb;--accent-soft:#172554;--accent-text:#dbeafe;--figure-bg:#0d1627;--shadow:0 10px 35px rgba(0,0,0,.48)}
`;
