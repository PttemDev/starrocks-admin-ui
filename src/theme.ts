import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';

/**
 * The antd theme, shared by the app's <ConfigProvider> and by the detached
 * root that antd's static APIs (Modal.confirm, message.*, notification.*)
 * render into — see ThemedHolder in App.tsx.
 */
export function buildAntdTheme(isDark: boolean): ThemeConfig {
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? '#818cf8' : '#6366f1',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ef4444',
      colorInfo: '#3b82f6',
      borderRadius: 8,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    },
    components: {
      // Light-only surface tints; in dark the algorithm's own values are
      // correct and hardcoding these would punch holes in the palette.
      Table: isDark
        ? {}
        : {
            headerBg: '#f8fafc',
            headerColor: '#64748b',
            rowHoverBg: '#f8fafc',
            borderColor: '#f1f5f9',
          },
      Button: {
        borderRadius: 8,
      },
      Card: {
        borderRadiusLG: 12,
      },
    },
  };
}
