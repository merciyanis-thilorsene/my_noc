/** Available UI themes. Applied via a `data-theme` attribute on the document root. */
export type ThemeName = 'light' | 'dark';

const KEY = 'sharingan.theme';

export function getTheme(): ThemeName {
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}
