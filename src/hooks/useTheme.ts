import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Resolves the stored theme preference to a concrete light/dark value and
 * stamps `data-theme` on <html>, which is what the CSS variables key off.
 * In "system" mode it keeps following the OS while the app is open.
 */
export function useTheme() {
  const mode = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.(DARK_QUERY).matches ?? false,
  );

  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      isDark ? 'dark' : 'light',
    );
  }, [isDark]);

  return { mode, isDark, setTheme };
}
