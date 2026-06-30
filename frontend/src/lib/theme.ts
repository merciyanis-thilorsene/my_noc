/** Available UI themes. Applied via a `data-theme` attribute on the document root. */
export type ThemeName = 'slate' | 'sharingan';

const KEY = 'sharingan.theme';

export function getTheme(): ThemeName {
  const t = localStorage.getItem(KEY);
  return t === 'sharingan' ? 'sharingan' : 'slate';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}
